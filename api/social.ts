import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const normalizeEmail=(v:any)=>String(v??'').trim().toLowerCase();

export default async function handler(req:VercelRequest,res:VercelResponse){
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return res.status(503).json({error:'Server database is not configured'});
  const db=createClient(url,key,{auth:{persistSession:false}});
  const token=String(req.method==='GET'?req.query.token:req.body?.token||'').trim();
  if(!token)return res.status(400).json({error:'Signup link is required'});

  try{
    const {data:link,error:linkError}=await db.from('lbg_signup_links').select('*').eq('token',token).maybeSingle();
    if(linkError)throw linkError;
    if(!link||!link.active)return res.status(404).json({error:'This signup link is not available'});
    if(link.expires_at&&new Date(link.expires_at).getTime()<Date.now())return res.status(410).json({error:'This signup link has expired'});
    if(link.max_uses!=null&&(link.use_count||0)>=link.max_uses)return res.status(410).json({error:'This signup link has already been used'});

    if(req.method==='GET'){
      await db.from('lbg_signup_links').update({open_count:(link.open_count||0)+1,last_opened_at:new Date().toISOString()}).eq('id',link.id);
      return res.status(200).json({
        customer_name:link.customer_name||'',
        service_id:link.service_id||null,
        service_name:link.service_name||'',
        source:link.source||'Direct',
        link_type:link.link_type||'personal'
      });
    }

    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});

    const b=req.body||{},email=normalizeEmail(b.email);
    if(!b.name||!email||!b.phone)return res.status(400).json({error:'Name, email and phone are required'});

    const now=new Date().toISOString();
    const {data:customer,error:customerError}=await db.from('lbg_customers').upsert({
      name:String(b.name).trim(),
      email,
      phone:String(b.phone||'').trim(),
      source:link.source||'Direct',
      updated_at:now
    },{onConflict:'email'}).select().single();
    if(customerError)throw customerError;

    let bikeId:string|null=null;
    const make=String(b.make||'').trim(),model=String(b.model||'').trim();
    if(make||model||b.year||b.bike_type){
      const bikeRow:any={
        customer_id:customer.id,
        make,
        model,
        bike_type:String(b.bike_type||'').trim()
      };
      if(String(b.year||'').trim()){
        const n=Number(b.year);
        if(Number.isFinite(n))bikeRow.year=n;
      }
      const {data:bike,error:bikeError}=await db.from('lbg_customer_bikes').insert(bikeRow).select('id').single();
      if(bikeError)throw bikeError;
      bikeId=bike.id;
    }

    const bikeSummary=[make,model].filter(Boolean).join(' ')||'Not provided';
    const leadMessage=[
      'SOCIAL SIGNUP',
      `Source: ${link.source||'Direct'}`,
      `Bike: ${bikeSummary}`,
      b.year?`Year: ${b.year}`:'',
      b.bike_type?`Type: ${b.bike_type}`:'',
      link.service_name?`Service interest: ${link.service_name}`:'',
      b.notes?`Notes: ${String(b.notes).trim()}`:''
    ].filter(Boolean).join('\n');
    const {error:messageError}=await db.from('messages').insert({
      name:String(b.name).trim(),
      email,
      phone:String(b.phone||'').trim(),
      message:leadMessage,
      status:'new'
    });
    if(messageError)throw messageError;

    if(link.service_name){
      const bikeLabel=[make,model].filter(Boolean).join(' ')||'Bike';
      const {error:appointmentError}=await db.from('appointments').insert({
        name:String(b.name).trim(),
        email,
        phone:String(b.phone||'').trim(),
        bike:bikeLabel,
        service:link.service_name,
        service_method:'',
        parts_option:'',
        details:String(b.notes||'').trim(),
        status:'requested',
        customer_id:customer.id,
        bike_id:bikeId
      });
      if(appointmentError)throw appointmentError;
    }

    const nextUses=(link.use_count||0)+1;
    const changes:any={use_count:nextUses,last_used_at:now};
    if(link.max_uses!=null&&nextUses>=link.max_uses)changes.active=false;
    const {error:updateError}=await db.from('lbg_signup_links').update(changes).eq('id',link.id);
    if(updateError)throw updateError;

    return res.status(200).json({ok:true,customer_id:customer.id,bike_id:bikeId});
  }catch(e:any){
    console.error(e);
    return res.status(500).json({error:e.message||'Signup failed'});
  }
}
