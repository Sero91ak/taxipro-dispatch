import {createTaxiPushClient} from './push-client.js';

/** Integration settings stay in the EXISTING TaxiPro portal. */
export function createIntegrationsUI({request,toast,getUser,getPage,getDate}){
 let data=null;
 const push=createTaxiPushClient({request,toast});
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const flag=(ready,extra)=>'<span class="center-pill '+(ready?'state-ok':'state-unknown')+'">'+
  (ready?'Konfiguriert':'Nicht eingerichtet')+' · '+esc(extra)+'</span>';
 function view(){
  const me=getUser(),p=data?.oneSignal||{},c=data?.claude||{};
  const goog=me?.role==='admin'?'<section class="center-panel">'+
   '<div class="center-panel-head"><b>Google Workspace · Taxi Meckenheim</b></div>'+
   '<div class="integration-list">'+
   '<div><b>Taxi-Kalender</b>'+flag(data?.google?.taxiCalendar,'Nur lesend')+'</div>'+
   '<div><b>Google Drive / Master-Kundenakte</b>'+flag(data?.google?.masterSheets,'Nur lesend')+'</div>'+
   '<div><b>Google Kontakte</b>'+flag(data?.google?.contacts,'Nur lesend')+'</div></div>'+
   '<p class="center-caption">Konfiguriert bedeutet nicht automatisch erfolgreich synchronisiert. Quellenstand und Fehler im Dashboard kontrollieren.</p></section>':'';
  return '<div class="center-shell">'+
   '<div class="center-welcome"><div><div class="center-eyebrow">TAXIPRO · VERBINDUNGEN</div>'+
   '<h2>Geschützte Integrationen</h2>'+
   '<p>Eine App, getrennte Rollen und ein gemeinsamer Datenstand</p></div>'+
   '<button type="button" class="btn" data-taxi-integration="refresh">↻ Status prüfen</button></div>'+
   goog+
   '<section class="center-panel"><div class="center-panel-head"><b>OneSignal · Mitarbeiter-Benachrichtigungen</b>'+
   flag(p.ready,'TaxiPro Push')+'</div>'+
   '<div class="integration-actions"><p>Nur allgemeine Hinweise. Keine Kundennamen, Chattexte oder Fahrziele auf dem Sperrbildschirm.</p>'+
   '<button type="button" class="btn gold" data-taxi-integration="subscribe" '+(!p.ready?'disabled':'')+'>Benachrichtigungen auf diesem Gerät erlauben</button>'+
   '<button type="button" class="btn" data-taxi-integration="unsubscribe">Benachrichtigungen deaktivieren</button></div>'+
   '<p class="center-caption">Auf dem iPhone die Web-App zum Home-Bildschirm hinzufügen. Push benötigt die Zustimmung im jeweiligen Betriebssystem.</p></section>'+
   (me?.role==='admin'?'<section class="center-panel"><div class="center-panel-head"><b>Claude · anonymisierte Tagesübersicht</b>'+
     flag(c.ready,'Kostenpflichtige API')+'</div>'+
     '<div class="integration-actions"><p>Nur statistische Tageszahlen ohne Patientendaten und nur nach gesonderter Kostenfreigabe.</p>'+
     '<button class="btn" data-taxi-integration="claude" '+(!c.ready?'disabled':'')+'>Anonymisierte Zusammenfassung erzeugen</button>'+
     '<div class="integration-result" id="taxipro-claude-result" role="status"></div></div></section>':'')+
   '<p class="center-caption">ChatGPT-Verbindungen sind nicht automatisch OAuth-Schlüssel für TaxiPro. Es werden keine API-Geheimnisse im Browser gespeichert.</p></div>';
 }
 async function load(){
  try{
   data=await request('/api/integrations/status');
   if(getPage()==='integrations'&&document.getElementById('pageView'))
    document.getElementById('pageView').innerHTML=view();
  }catch(e){toast('Verbindungsprüfung: '+e.message)}
 }
 document.addEventListener('click',e=>{
  const button=e.target.closest('[data-taxi-integration]');if(!button)return;
  button.disabled=true;
  (async()=>{
   const action=button.dataset.taxiIntegration;
   if(action==='refresh')return load();
   if(action==='subscribe'){await push.subscribe();toast('Push für dieses Gerät freigegeben.');return}
   if(action==='unsubscribe'){
    const o=await push.unsubscribe();toast(o.removed?'Push auf diesem Gerät deaktiviert.':'Push lokal deaktiviert; Serverfreigabe überprüfen.');return;
   }
   if(action==='claude'){
    const response=await request('/api/integrations/claude-summary','POST',{action:'daily_overview',date:getDate()});
    const node=document.getElementById('taxipro-claude-result');
    if(node)node.textContent=response.text;return;
   }
  })().catch(err=>toast(err.message)).finally(()=>button.disabled=false);
 });
 return {view,load,logout:push.logout};
}
