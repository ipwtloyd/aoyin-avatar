import { getStore } from "@netlify/blobs";

const reply=(status,data)=>new Response(JSON.stringify(data),{
 status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
});
const store=()=>getStore({name:"aoyin-comments",consistency:"strong"});
const cleanDevice=s=>typeof s==="string"&&/^[a-zA-Z0-9.-]{8,100}$/.test(s)?s:null;

export default async (request)=>{
 try{
  const db=store();
  if(request.method==="GET"){
   const keys=await db.list({prefix:"comment:"});
   const items=await Promise.all(keys.blobs.slice(0,300).map(async k=>db.get(k.key,{type:"json"})));
   const comments=items.filter(x=>x&&!x.hidden).sort((a,b)=>a.createdAt-b.createdAt).slice(-100);
   return reply(200,{comments});
  }
  if(request.method!=="POST")return reply(405,{error:"不支援此方法"});
  const body=await request.json().catch(()=>null);
  if(!body)return reply(400,{error:"資料格式錯誤"});
  const device=cleanDevice(body.device);
  if(!device)return reply(400,{error:"裝置識別碼錯誤"});
  if(body.action==="create"){
   const text=typeof body.text==="string"?body.text.trim():"";
   const nickname=typeof body.nickname==="string"?body.nickname.trim():"";
   if(!nickname||[...nickname].length>16)return reply(400,{error:"暱稱需為 1～16 字"});
   if(!text||[...text].length>80)return reply(400,{error:"留言需為 1～80 字"});
   const rateKey="rate:"+device;
   const previous=Number(await db.get(rateKey,{type:"text"})||0);
   const now=Date.now();
   if(now-previous<15000)return reply(429,{error:"請等候 "+Math.ceil((15000-(now-previous))/1000)+" 秒再發送留言"});
   await db.set(rateKey,String(now));
   const id=crypto.randomUUID();
   const c={id,text,nickname,createdAt:now,likes:0,likedBy:[],reportedBy:[],hidden:false};
   await db.setJSON("comment:"+id,c);
   return reply(201,{id});
  }
  if(!["like","report"].includes(body.action))return reply(400,{error:"操作不支援"});
  const id=typeof body.id==="string"?body.id:"";
  if(!/^[0-9a-f-]{36}$/i.test(id))return reply(400,{error:"留言識別碼錯誤"});
  const key="comment:"+id,c=await db.get(key,{type:"json"});
  if(!c||c.hidden)return reply(404,{error:"這則留言已不存在"});
  if(body.action==="like"){
   if(c.likedBy.includes(device))return reply(409,{error:"你已經按過讚了"});
   c.likedBy.push(device);c.likes=c.likedBy.length;
  }else{
   if(c.reportedBy.includes(device))return reply(409,{error:"你已經檢舉過這則留言"});
   c.reportedBy.push(device);
   if(c.reportedBy.length>=5)c.hidden=true;
  }
  await db.setJSON(key,c);
  return reply(200,{ok:true,hidden:c.hidden,likes:c.likes,reports:c.reportedBy.length});
 }catch(e){
  console.error(e);
  return reply(500,{error:"伺服器暫時無法處理，請稍後再試"});
 }
};
export const config={path:"/api/comments"};
