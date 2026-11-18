/**
 * Existing TaxiPro PWA + OneSignal Web SDK v16.
 * Opt-in is initiated only by a staff member's click. No patient data,
 * OneSignal external_id, REST key or personal messages leave TaxiPro.
 * OneSignal SW uses a separate /v2/push/ scope; never replace /v2/sw.js.
 */
export function createTaxiPushClient({request,toast}){
 let sdk=null,pending=null,subscriptionId=null;
 async function ready(){
  if(sdk)return sdk;
  if(pending)return pending;
  pending=(async()=>{
   const info=await request('/api/integrations/status');
   if(!info.oneSignal?.ready||!info.oneSignal.appId)
     throw Error('Eine eigene TaxiPro-OneSignal-App wurde noch nicht eingerichtet.');
   if(!('serviceWorker' in navigator)||!('Notification' in window))
     throw Error('Dieser Browser unterstützt Web-Push nicht.');
   await new Promise((resolve,reject)=>{
    if(window.OneSignal){resolve();return}
    window.OneSignalDeferred=window.OneSignalDeferred||[];
    const existing=document.querySelector('script[data-taxi-onesignal]');
    if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',()=>reject(Error('SDK nicht erreichbar')),{once:true});return}
    const script=document.createElement('script');
    script.dataset.taxiOnesignal='1';script.async=true;
    script.src='https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
    script.onload=resolve;script.onerror=()=>reject(Error('OneSignal-SDK nicht erreichbar'));
    document.head.append(script);
   });
   const oneSignal=await new Promise((resolve,reject)=>{
    window.OneSignalDeferred.push(async O=>{try{
     await O.init({
      appId:info.oneSignal.appId,
      serviceWorkerPath:'push/OneSignalSDKWorker.js',
      serviceWorkerParam:{scope:'/taxipro-dispatch/v2/push/'},
      notifyButton:{enable:false}
     });
     resolve(O);
    }catch(e){reject(e)}});
   });
   sdk=oneSignal;return sdk;
  })();
  try{return await pending}finally{pending=null}
 }
 async function subscribe(){
  const O=await ready();
  if(!O.Notifications.isPushSupported())
    throw Error('Auf diesem Gerät ist Push nicht verfügbar. Auf iOS die TaxiPro-Web-App zum Home-Bildschirm hinzufügen.');
  const granted=await O.Notifications.requestPermission();
  if(!granted)throw Error('Benachrichtigungen wurden vom Gerät nicht erlaubt.');
  if(!O.User.PushSubscription.optedIn)
   await O.User.PushSubscription.optIn();
  const id=O.User.PushSubscription.id;
  if(!id)throw Error('OneSignal konnte noch keine eindeutige Gerätekennung bereitstellen.');
  await request('/api/integrations/push','POST',{subscriptionId:id});
  subscriptionId=id;
  return {subscribed:true};
 }
 async function unsubscribe(){
  const O=sdk;
  const id=subscriptionId||O?.User?.PushSubscription?.id;
  let removed=!id;
  try{if(id){await request('/api/integrations/push/'+encodeURIComponent(id),'DELETE');removed=true}}
  finally{
   if(O)await O.User.PushSubscription.optOut().catch(()=>{});
   subscriptionId=null;
  }
  return {removed};
 }
 async function logout(){
  const O=sdk,id=subscriptionId||O?.User?.PushSubscription?.id;
  // Best effort: generic notifications are never allowed to display
  // customer or patient details even if server is unreachable on logout.
  try{if(id)await request('/api/integrations/push/'+encodeURIComponent(id),'DELETE')}
  catch{}finally{
   if(O)await O.User.PushSubscription.optOut().catch(()=>{});
   subscriptionId=null;
  }
 }
 return {subscribe,unsubscribe,logout};
}
