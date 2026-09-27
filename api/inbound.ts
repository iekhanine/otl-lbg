import type { VercelRequest,VercelResponse } from '@vercel/node';
import {createClient} from '@supabase/supabase-js';
import {Resend} from 'resend';

const address=(v:any)=>{
  const s=String(v??'').trim();
  const m=s.match(/<([^>]+)>/);
  return (m?.[1]||s).trim().toLowerCase();
};
const stripHtml=(html:string)=>html.replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();

export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,api=process.env.RESEND_API_KEY;
 if(!url||!key)return res.status(503).json({error:'Server database is not configured'});
 const event=req.body||{};
 if(event.type!=='email.received')return res.status(200).json({ok:true,ignored:true});
 const d=event.data||{},emailId=d.email_id||d.id;
 if(!emailId||!api)return res.status(400).json({error:'Inbound email data is incomplete'});
 try{
   const db=createClient(url,key,{auth:{persistSession:false}});
   const {data:existing}=await db.from('messages').select('id').eq('external_message_id',String(emailId)).maybeSingle();
   if(existing)return res.status(200).json({ok:true,duplicate:true});
   const resend:any=new Resend(api);
   let full:any=d;
   try{
     const got=await resend.emails.receiving.get(String(emailId));
     full=got?.data||got||d;
   }catch(err){console.error('Could not fetch received email body',err)}
   const from=address(full.from||d.from),subject=String(full.subject||d.subject||'Email reply');
   const body=String(full.text||'').trim()||stripHtml(String(full.html||''));
   if(!from||!body)return res.status(200).json({ok:true,ignored:true});
   const {data:customer}=await db.from('lbg_customers').select('name,phone').eq('email',from).maybeSingle();
   const {error}=await db.from('messages').insert({
     name:customer?.name||String(full.from||d.from||from),
     email:from,
     phone:customer?.phone||'',
     message:body,
     status:'new',
     direction:'inbound',
     subject,
     external_message_id:String(emailId)
   });
   if(error)throw error;
   return res.status(200).json({ok:true});
 }catch(e:any){console.error(e);return res.status(500).json({error:e.message||'Inbound email failed'})}
}
