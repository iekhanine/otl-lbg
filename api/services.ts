import type {VercelRequest,VercelResponse} from '@vercel/node';
import{createClient}from'@supabase/supabase-js';
export default async function handler(req:VercelRequest,res:VercelResponse){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return res.status(503).json({error:'Server database is not configured'});
 try{const db=createClient(url,key,{auth:{persistSession:false}});const{data,error}=await db.from('services').select('id,name,description,price,price_unit,sort_order').eq('active',true).order('sort_order').order('name');if(error)throw error;return res.json(Array.isArray(data)?data:[])}catch(e:any){return res.status(500).json({error:e.message||'Unable to load services'})}
}
