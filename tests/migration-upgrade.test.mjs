import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {readFileSync} from 'node:fs';

const full=readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('../backend/migration-v2.4.sql',import.meta.url),'utf8');
const cut=full.indexOf('-- TaxiPro 2.4: canonical customer file');
assert.ok(cut>5000,'Previous v2.3 schema section exists');
// Reconstruct the prior schema without the newly introduced billing column.
// This fixture is synthesized from the same repository to prevent drift.
const oldSchema=full.slice(0,cut).replace(
 /\n billing_class TEXT NOT NULL DEFAULT 'unknown' CHECK\(billing_class IN \('KTS','RE','private','unknown'\)\),/g,
 ''
);
test('v2.3 migration keeps original customer IDs, assigned trips, driver accounts and shift data',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON;'+oldSchema);
 const columnsBefore=db.prepare('PRAGMA table_info(rides)').all().map(r=>r.name);
 assert.ok(!columnsBefore.includes('billing_class'),'Pre-upgrade ride schema has no billing_class');
 assert.ok(!db.prepare('PRAGMA table_info(recurring_orders)').all().some(r=>r.name==='billing_class'),'Legacy series schema has no billing_class');
 const admin='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',driver='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const patient='cccccccc-cccc-4ccc-8ccc-cccccccccccc',ride='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const now='2026-11-18T08:00:00.000Z';
 db.prepare("INSERT INTO users(id,username,display_name,role,salt,password_hash,created_at) VALUES(?,'testadmin','Zentrale','admin','salt','hash',?)").run(admin,now);
 db.prepare("INSERT INTO users(id,username,display_name,role,salt,password_hash,created_at) VALUES(?,'testdriver','Fahrer','driver','salt','hash',?)").run(driver,now);
 db.prepare("INSERT INTO customers(id,name,pickup,destination,kind,created_at) VALUES(?,'Testkunde','Meckenheim','Bonn','Krankenfahrt',?)").run(patient,now);
 db.prepare(`INSERT INTO rides(id,customer_id,driver_id,ride_date,ride_time,pickup,destination,kind,direction,status,assigned_at)
   VALUES(?,?,?,'2026-11-18','10:10','Meckenheim','Bonn','Krankenfahrt','hin','assigned',?)`).run(ride,patient,driver,now);
 db.prepare("INSERT INTO shifts(id,driver_id,started_at) VALUES(?,?,?)").run('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',driver,now);
 db.exec('BEGIN');
 try{db.exec(migration);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
 const record=db.prepare('SELECT id,customer_id,driver_id,ride_date,ride_time,status,billing_class FROM rides WHERE id=?').get(ride);
 assert.equal(record.id,ride);
 assert.equal(record.customer_id,patient);
 assert.equal(record.driver_id,driver);
 assert.equal(record.billing_class,'unknown','Do not retroactively infer KTS from medical trip category');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shifts WHERE driver_id=?').get(driver).n,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM customers WHERE id=?').get(patient).n,1);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n,2);
 db.prepare("UPDATE rides SET billing_class='KTS' WHERE id=?").run(ride);
 assert.equal(db.prepare('SELECT billing_class FROM rides WHERE id=?').get(ride).billing_class,'KTS');
 assert.ok(db.prepare('PRAGMA table_info(recurring_orders)').all().some(r=>r.name==='billing_class'),'Serienfahrten behalten neue KTS/RE-Spalte');
 for(const table of ['ride_reviews','journey_ledger','calendar_imports','customer_routes','customer_case_status','user_display_settings']){
   assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table).name,table);
 }
 db.close();
});
