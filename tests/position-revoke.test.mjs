import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../backend/worker.js';

function fresh(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON;'+readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8'));
 const db={async batch(statements){
  sqlite.exec('BEGIN IMMEDIATE');try{
   const results=[];for(const st of statements)results.push(await st.run());
   sqlite.exec('COMMIT');return results;
  }catch(error){sqlite.exec('ROLLBACK');throw error}
 },prepare(query){
  let values=[];return {bind(...params){values=params;return this},
   first(){return sqlite.prepare(query).get(...values)||null},
   all(){return {results:sqlite.prepare(query).all(...values)}},
   run(){return {meta:{changes:sqlite.prepare(query).run(...values).changes}}}
  };
 }};
 return {sqlite,db};
}
test('Fahrer widerruft den letzten GPS-Standort und kann niemals fremde Positionen löschen',async()=>{
 const {sqlite,db}=fresh();
 const env={DB:db,APP_ORIGIN:'https://sero91ak.github.io',
  BOOTSTRAP_SECRET:'only-a-synthetic-tests-secret-long-enough-2026'};
 const call=async(path,method='GET',body=null,token='')=>{
  const res=await worker.fetch(new Request('https://worker.test'+path,{
   method,headers:{Origin:env.APP_ORIGIN,...(token?{Authorization:'Bearer '+token}:{}),
      ...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})
  }),env);
  return {status:res.status,data:await res.json()};
 };
 const setup=await call('/api/bootstrap','POST',{
  setupSecret:env.BOOTSTRAP_SECRET,username:'admin',
  displayName:'Test-Zentrale',password:'SyntheticStrongAdminPass_123456'
 });
 assert.equal(setup.status,201);
 const admin=await call('/api/login','POST',{username:'admin',password:'SyntheticStrongAdminPass_123456'});
 assert.equal(admin.status,200);
 const adminToken=admin.data.token;
 const driver1=await call('/api/users','POST',{
  username:'testdriver1',displayName:'Fahrer 1',password:'TestDriverAccessPass_123456'},adminToken);
 const driver2=await call('/api/users','POST',{
  username:'testdriver2',displayName:'Fahrer 2',password:'TestDriverAccessPass_654321'},adminToken);
 assert.equal(driver1.status,201);assert.equal(driver2.status,201);
 const d1=await call('/api/login','POST',{username:'testdriver1',password:'TestDriverAccessPass_123456'});
 const d2=await call('/api/login','POST',{username:'testdriver2',password:'TestDriverAccessPass_654321'});
 const start1=await call('/api/shifts','POST',{action:'start'},d1.data.token);
 const start2=await call('/api/shifts','POST',{action:'start'},d2.data.token);
 assert.equal(start1.status,200);assert.equal(start2.status,200);
 const p1=await call('/api/position','POST',{latitude:50.624,longitude:7.032,accuracy:15},d1.data.token);
 const p2=await call('/api/position','POST',{latitude:50.620,longitude:7.030,accuracy:18},d2.data.token);
 assert.equal(p1.status,200);assert.equal(p2.status,200);
 let positions=(await call('/api/state','GET',null,adminToken)).data.positions;
 assert.equal(positions.length,2);
 assert.equal((await call('/api/position','DELETE',null,adminToken)).status,403);
 const result=await call('/api/position','DELETE',null,d1.data.token);
 assert.equal(result.status,200);
 assert.equal(result.data.disabled,true);
 assert.equal(result.data.removed,1);
 positions=(await call('/api/state','GET',null,adminToken)).data.positions;
 assert.equal(positions.length,1);
 assert.equal(positions[0].driver_id,driver2.data.id,'Only the other driver remains');
 const again=await call('/api/position','DELETE',null,d1.data.token);
 assert.equal(again.status,200);
 assert.equal(again.data.removed,0,'Repeated revocation is safe');
 const audit=sqlite.prepare("SELECT COUNT(*) AS n FROM audit WHERE event='position.revoked' AND actor_id=?")
   .get(driver1.data.id);
 assert.equal(audit.n,2);
 const cors=await worker.fetch(new Request('https://worker.test/api/position',{
  method:'OPTIONS',headers:{Origin:env.APP_ORIGIN,'Access-Control-Request-Method':'DELETE'}
 }),env);
 assert.equal(cors.status,204);
 assert.match(cors.headers.get('Access-Control-Allow-Methods'),/DELETE/);
 sqlite.close();
});
