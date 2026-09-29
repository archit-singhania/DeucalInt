import http from 'k6/http';
import { check, sleep } from 'k6';
export const options={vus:5,duration:'20s',thresholds:{http_req_failed:['rate<0.01'],http_req_duration:['p(95)<1000']}};
export default function(){
  const event={eventId:`load-${__VU}-${__ITER}-${Date.now()}`,schemaVersion:1,type:'product',name:'load_event',timestamp:new Date().toISOString(),anonymousId:`load-${__VU}`,sessionId:`load-${__VU}`,properties:{}};
  const r=http.post((__ENV.ENDPOINT||'http://127.0.0.1:8100')+'/v1/batch',JSON.stringify({projectToken:__ENV.TOKEN||'pk_sandbox_deucalint',events:Array.from({length:20},(_,i)=>({...event,eventId:event.eventId+'-'+i}))}),{headers:{'Content-Type':'application/json'}});
  check(r,{'accepted':r.status===202});sleep(3);
}
