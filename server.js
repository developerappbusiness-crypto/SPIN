const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000, ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'admin123';
const DIR=process.env.DATA_DIR||path.join(__dirname,'data'); fs.mkdirSync(DIR,{recursive:true});
const FILE=path.join(DIR,'db.json');
const DEFAULT=[
 ['android','Android Phone','📱',0,true],['airbuds','Bluetooth Airbuds','🎧',25,true],
 ['powerbank','Power Bank','🔋',15,true],['watch','Smart Watch','⌚',0,true],
 ['diamond','FF Diamond Topup','💎',25,true],['mystery','Mystery Gift','🎁',10,true],
 ['clown','','🤡',25,false]];
let db={}; try{db=JSON.parse(fs.readFileSync(FILE,'utf8'))}catch{}
db.users??={};db.ips??={};db.devices??={};db.spins??=[];db.sessions??={};db.admin??={};db.cost??=100;
db.prizes??=DEFAULT.map(([key,label,emoji,weight,win])=>({key,label,emoji,weight,win}));
function save(){fs.writeFileSync(FILE+'.tmp',JSON.stringify(db));fs.renameSync(FILE+'.tmp',FILE)}
const rnd=()=>crypto.randomBytes(24).toString('hex');
const hash=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
const clean=(s,n=30)=>String(s??'').replace(/[<>]/g,'').trim().slice(0,n);
const getIp=r=>{const x=(r.headers['x-forwarded-for']||'').split(',').map(s=>s.trim()).filter(Boolean);
  return (process.env.TRUST_PROXY!=='0'&&x.length?x[x.length-1]:r.socket.remoteAddress)||'unknown'};
const hits={};function limited(ip,max){const n=Date.now(),h=hits[ip]=(hits[ip]||[]).filter(t=>n-t<60000);h.push(n);return h.length>max}
const pubUser=u=>({id:u.id,username:u.username,name:u.name,points:u.points,spun:u.spun});
const pubPrizes=()=>db.prizes.map(p=>({key:p.key,label:p.label,emoji:p.emoji}));
class E extends Error{constructor(m,c=400){super(m);this.code=c}}
const authUser=r=>{const id=db.sessions[(r.headers.authorization||'').replace('Bearer ','')];const u=id&&db.users[id];if(!u)throw new E('Please login',401);if(u.banned)throw new E('Account blocked',403);return u};
const authAdmin=r=>{if(!db.admin[(r.headers.authorization||'').replace('Bearer ','')])throw new E('Admin login required',401)};
const R={};
R['POST /api/signup']=(r,b,c)=>{
  const username=clean(b.username,20).toLowerCase(),name=clean(b.name),pw=String(b.password||'');
  if(!/^[a-z0-9_]{3,20}$/.test(username))throw new E('Username: 3-20 letters, numbers or _');
  if(!name)throw new E('Enter your name'); if(pw.length<4)throw new E('Password min 4 characters');
  if(Object.values(db.users).some(u=>u.username===username))throw new E('Username already taken');
  if(db.ips[c.ip]?.signup||db.devices[c.did])throw new E('An account was already created from this device/network',403);
  const salt=rnd().slice(0,16),id=rnd().slice(0,12);
  db.users[id]={id,username,name,salt,pass:hash(pw,salt),points:0,spun:false,banned:false,ip:c.ip,did:c.did,created:Date.now()};
  (db.ips[c.ip]??={}).signup=id;db.devices[c.did]=id;
  const t=rnd();db.sessions[t]=id;save();return{token:t,user:pubUser(db.users[id]),prizes:pubPrizes(),cost:db.cost};
};
R['POST /api/login']=(r,b)=>{
  const u=Object.values(db.users).find(u=>u.username===clean(b.username,20).toLowerCase());
  if(!u||hash(String(b.password||''),u.salt)!==u.pass)throw new E('Wrong username or password',401);
  if(u.banned)throw new E('Account blocked',403);
  const t=rnd();db.sessions[t]=u.id;save();return{token:t,user:pubUser(u),prizes:pubPrizes(),cost:db.cost};
};
R['GET /api/me']=r=>{const u=authUser(r);return{user:pubUser(u),prizes:pubPrizes(),cost:db.cost,
  mySpins:db.spins.filter(s=>s.userId===u.id).map(s=>({emoji:s.emoji,label:s.label,time:s.time}))}};
R['POST /api/spin']=(r,b,c)=>{
  const u=authUser(r),name=clean(b.name);
  if(!name)throw new E('Enter your name before spinning');
  if(u.spun)throw new E('You already used your spin. Ask admin for a reset.',403);
  if(db.ips[c.ip]?.spun)throw new E('This network already used its spin. Ask admin for a reset.',403);
  if(u.points<db.cost)throw new E(`You need ${db.cost} points to spin. Ask admin for points.`,403);
  const total=db.prizes.reduce((a,p)=>a+p.weight,0);let idx=db.prizes.findIndex(p=>p.key==='clown');
  if(total>0){let x=crypto.randomInt(total);for(let i=0;i<db.prizes.length;i++){if(x<db.prizes[i].weight){idx=i;break}x-=db.prizes[i].weight}}
  const p=db.prizes[idx];u.points-=db.cost;u.spun=true;u.name=name;(db.ips[c.ip]??={}).spun=u.id;
  db.spins.push({id:rnd().slice(0,10),userId:u.id,username:u.username,name,ip:c.ip,key:p.key,label:p.label,emoji:p.emoji,win:p.win,time:Date.now()});
  save();return{index:idx,prize:{key:p.key,label:p.label,emoji:p.emoji},points:u.points};
};
R['POST /api/admin/login']=(r,b)=>{
  const a=Buffer.from(String(b.password||'')),e=Buffer.from(ADMIN_PASSWORD);
  if(a.length!==e.length||!crypto.timingSafeEqual(a,e))throw new E('Wrong admin password',401);
  const t=rnd();db.admin[t]=Date.now();save();return{token:t};
};
R['GET /api/admin/data']=r=>{authAdmin(r);return{cost:db.cost,prizes:db.prizes,
  users:Object.values(db.users).map(u=>({...pubUser(u),banned:u.banned,ip:u.ip,created:u.created})),
  spins:db.spins.slice().reverse().slice(0,300),
  ips:Object.entries(db.ips).map(([ip,v])=>({ip,signup:v.signup&&db.users[v.signup]?.username,spun:v.spun&&db.users[v.spun]?.username}))}};
R['POST /api/admin/points']=(r,b)=>{authAdmin(r);const u=db.users[b.id];if(!u)throw new E('No such user');
  const d=parseInt(b.delta,10);if(!Number.isFinite(d)||Math.abs(d)>1e6)throw new E('Invalid points');u.points=Math.max(0,u.points+d);save();return{ok:1}};
R['POST /api/admin/reset']=(r,b)=>{authAdmin(r);const u=db.users[b.id];if(!u)throw new E('No such user');
  u.spun=false;for(const v of Object.values(db.ips))if(v.spun===u.id)delete v.spun;save();return{ok:1}};
R['POST /api/admin/reset-ip']=(r,b)=>{authAdmin(r);if(db.ips[b.ip]){const v=db.ips[b.ip];const u=db.users[v.spun];if(u)u.spun=false;delete v.spun}save();return{ok:1}};
R['POST /api/admin/ban']=(r,b)=>{authAdmin(r);const u=db.users[b.id];if(!u)throw new E('No such user');u.banned=!!b.banned;save();return{ok:1}};
R['POST /api/admin/delete-user']=(r,b)=>{authAdmin(r);const u=db.users[b.id];if(!u)throw new E('No such user');
  for(const v of Object.values(db.ips)){if(v.signup===u.id)delete v.signup;if(v.spun===u.id)delete v.spun}
  for(const k of Object.keys(db.devices))if(db.devices[k]===u.id)delete db.devices[k];
  for(const k of Object.keys(db.sessions))if(db.sessions[k]===u.id)delete db.sessions[k];
  delete db.users[u.id];save();return{ok:1}};
R['POST /api/admin/settings']=(r,b)=>{authAdmin(r);
  const w=b.weights||{},cost=parseInt(b.cost,10);if(!(cost>=0&&cost<=1e6))throw new E('Invalid cost');
  const next=db.prizes.map(p=>({...p,weight:parseInt(w[p.key],10)}));
  if(next.some(p=>!Number.isInteger(p.weight)||p.weight<0))throw new E('Chances must be whole numbers');
  if(next.reduce((a,p)=>a+p.weight,0)!==100)throw new E('Chances must total exactly 100');
  db.prizes=next;db.cost=cost;save();return{ok:1}};
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.ico':'image/x-icon'};
http.createServer((req,res)=>{
  const ip=getIp(req),url=new URL(req.url,'http://x'),ck=Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).filter(a=>a[0]));
  let did=ck.did;const hdr={};if(!did||!/^[a-f0-9]{24}$/.test(did)){did=rnd().slice(0,24);hdr['Set-Cookie']=`did=${did}; Path=/; Max-Age=315360000; HttpOnly; SameSite=Lax`}
  const send=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store',...hdr});res.end(JSON.stringify(obj))};
  const h=R[req.method+' '+url.pathname];
  if(url.pathname.startsWith('/api/')){
    if(!h)return send(404,{error:'Not found'});
    if(limited(ip+url.pathname.includes('login')+url.pathname.includes('signup'),url.pathname.includes('login')||url.pathname.includes('signup')?15:120))return send(429,{error:'Too many requests, slow down'});
    let body='';req.on('data',d=>{body+=d;if(body.length>10000)req.destroy()});
    return req.on('end',()=>{try{let b={};if(body)b=JSON.parse(body);send(200,h(req,b,{ip,did}))}catch(e){send(e.code||(e instanceof SyntaxError?400:500),{error:e.code?e.message:e instanceof SyntaxError?'Bad request':'Server error'});if(!e.code&&!(e instanceof SyntaxError))console.error(e)}});
  }
  let f=url.pathname==='/'?'/index.html':url.pathname==='/admin'?'/admin.html':url.pathname;
  const fp=path.join(__dirname,'public',path.normalize(f).replace(/^(\.\.[\/\\])+/,''));
  if(!fp.startsWith(path.join(__dirname,'public'))||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.writeHead(404);return res.end('Not found')}
  res.writeHead(200,{'Content-Type':TYPES[path.extname(fp)]||'application/octet-stream',...hdr});fs.createReadStream(fp).pipe(res);
}).listen(PORT,()=>console.log('Running on http://localhost:'+PORT+(ADMIN_PASSWORD==='admin123'?'  (WARNING: set ADMIN_PASSWORD!)':'')));
