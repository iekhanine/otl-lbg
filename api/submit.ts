import type { VercelRequest,VercelResponse } from '@vercel/node';
import {createClient} from '@supabase/supabase-js';
import {Resend} from 'resend';
import crypto from 'node:crypto';
const esc=(s:any)=>String(s??'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]!));
export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return res.status(503).json({error:'Server database is not configured'});
 const db=createClient(url,key,{auth:{persistSession:false}}),b=req.body||{},type=b.type;
 try{
  if(type==='appointment'){
   const row=b.appointment;if(!row?.name||!row?.email||!row?.phone||!row?.service)return res.status(400).json({error:'Missing required booking information'});
   const email=String(row.email).trim().toLowerCase();
    const {data:customer,error:customerError}=await db.from('lbg_customers').upsert({name:row.name,email,phone:row.phone||'',updated_at:new Date().toISOString()},{onConflict:'email'}).select().single();
    if(customerError)throw customerError;
    let bikeId:string|null=null;
    if(row.bike){
     const {data:existingBike,error:bikeLookupError}=await db.from('lbg_customer_bikes').select('id').eq('customer_id',customer.id).ilike('model',String(row.bike)).maybeSingle();
     if(bikeLookupError)throw bikeLookupError;
     if(existingBike?.id)bikeId=existingBike.id;
     else{const {data:newBike,error:bikeInsertError}=await db.from('lbg_customer_bikes').insert({customer_id:customer.id,model:String(row.bike)}).select('id').single();if(bikeInsertError)throw bikeInsertError;bikeId=newBike.id;}
    }
    const appointment={...row,customer_id:customer.id,bike_id:bikeId};
    const {error}=await db.from('appointments').insert(appointment);if(error)throw error;
   await notify(db,'appointment',row);
  }else if(type==='message'){
   const row=b.message;if(!row?.name||!row?.email||!row?.message)return res.status(400).json({error:'Missing required message information'});
   const photos=Array.isArray(b.photos)?b.photos.slice(0,5):[],paths:string[]=[];
   for(const photo of photos){
    if(!['image/jpeg','image/png','image/webp'].includes(photo?.type))throw new Error('Only JPG, PNG and WebP photos are allowed');
    const bytes=Buffer.from(String(photo?.data||''),'base64');
    if(bytes.length>10*1024*1024)throw new Error(`${photo?.name||'Photo'} is larger than 10MB`);
    const ext=photo.type==='image/png'?'png':photo.type==='image/webp'?'webp':'jpg';
    const path=`${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${ext}`;
    const {error:uploadError}=await db.storage.from('lbg-message-photos').upload(path,bytes,{contentType:photo.type,upsert:false});
    if(uploadError)throw uploadError;paths.push(path);
   }
   const messageRow={...row,photo_paths:paths};
   const {error}=await db.from('messages').insert(messageRow);if(error)throw error;
   await notify(db,'message',messageRow);
  }else return res.status(400).json({error:'Unknown submission type'});
  return res.status(200).json({ok:true});
 }catch(e:any){console.error(e);return res.status(500).json({error:e.message||'Submission failed'})}
}
async function notify(db:any,type:string,row:any){
 const {data:s}=await db.from('business_settings').select('*').eq('id',1).maybeSingle();
 if(s?.notifications_enabled===false)return;
 const to=String(s?.notification_email||'').trim(),api=process.env.RESEND_API_KEY;if(!api||!to)return;
 const subject=type==='appointment'?`New appointment request from ${row.name}`:`New message from ${row.name}`;
 const body=type==='appointment'?[`Service: ${row.service}`,`Requested: ${row.preferred_date||'No date'} ${row.preferred_time||''}`,`Method: ${row.service_method}`,`Email: ${row.email}`,`Phone: ${row.phone}`]:[`Email: ${row.email}`,`Phone: ${row.phone||''}`,`Message: ${row.message}`];
 const from=process.env.NOTIFICATION_FROM_EMAIL||'Local Bike Guy <inquiry@onetimelabs.net>';
 const conversationUrl=`https://lbg.onetimelabs.net/admin/inbox?email=${encodeURIComponent(String(row.email||'').trim().toLowerCase())}`;
 const sent:any=await new Resend(api).emails.send({
  from,
  replyTo:'no-reply@onetimelabs.net',
  to:[to],
  subject,
  html:`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#14213d"><h2>${esc(subject)}</h2>${body.map(x=>`<p>${esc(x)}</p>`).join('')}<p style="margin:28px 0"><a href="${conversationUrl}" style="display:inline-block;padding:12px 18px;background:#14213d;color:#fff;text-decoration:none;border-radius:6px">Open Conversation in LBG</a></p><p style="font-size:12px;color:#667085">This is an automated notification. Do not reply to this email. Open the conversation in Local Bike Guy to respond.</p></div>`
 });
 if(sent?.error){
  console.error('[Resend notification error]',sent.error);
  throw new Error(sent.error.message||'Notification email failed');
 }
}
