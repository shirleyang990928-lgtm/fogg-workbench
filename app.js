/* ===== 版本号：每次改完代码请同步更新，用于确认浏览器没有在用旧缓存 ===== */
const APP_VERSION='20260610d';
console.log('课堂工作台 app.js 版本：'+APP_VERSION);

/* ===== SUPABASE 配置 ===== */
const SUPABASE_URL='https://wotsmkagmblzcfaggdwh.supabase.co';
const SUPABASE_KEY='sb_publishable_y4wIYoLc8ZqhevLKKCK6Vg_FzxLX7LA';
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
let currentUser=null;

/* 登录成功后的统一入口：手动登录(doLogin)和自动恢复会话都走这里。
   返回 false 表示云端数据加载失败——此时绝不进入主界面、绝不 syncToCloud，
   防止把空数据写回云端覆盖真实数据 */
async function enterApp(user){
  currentUser=user;
  const loaded=await loadUserDataFromCloud();
  if(!loaded){
    currentUser=null;
    return false;
  }
  await syncToCloud();
  document.getElementById('loginOverlay').style.display='none';
  document.getElementById('appShell').style.display='grid';
  document.getElementById('userBadge').textContent=user.email+' · v'+APP_VERSION;
  updateClock();setInterval(updateClock,1000);
  setInterval(()=>{if(view==='today')render();},60000);
  render();
  injectAdminUI();
  return true;
}

async function doLogin(){
  const email=document.getElementById('loginEmail').value.trim();
  const pass=document.getElementById('loginPassword').value;
  const errEl=document.getElementById('loginError');
  errEl.textContent='登录中…';
  const {data,error}=await sb.auth.signInWithPassword({email,password:pass});
  if(error){errEl.textContent='邮箱或密码错误，请重试';return;}
  const ok=await enterApp(data.user);
  errEl.textContent=ok?'':'加载云端数据失败，请检查网络后重试';
}

async function doLogout(){
  await sb.auth.signOut();
  location.reload();
}

/* ===== 管理员功能 ===== */
const ADMIN_EMAIL='shirleyang990928@gmail.com';
let adminViewEmail=null; // null=看自己，否则=正在看某个同事

function isAdmin(){return currentUser&&currentUser.email===ADMIN_EMAIL;}

async function adminLoadUsers(){
  if(!isAdmin()) return [];
  const {data}=await sb.from('user_data').select('user_email,display_name');
  return data||[];
}

async function adminRefreshUsers(){
  const users=await adminLoadUsers();
  const sel=document.getElementById('adminUserSelect');
  if(!sel) return;
  const others=users.filter(u=>u.user_email!==currentUser.email);
  sel.innerHTML=`<option value="">— 切换查看用户 —</option>`+others.map(u=>`<option value="${u.user_email}">${u.user_email}${u.display_name?' ('+u.display_name+')':''}</option>`).join('');
  showToast('已刷新用户列表，共 '+others.length+' 人');
}

async function adminSwitchTo(email){
  if(!isAdmin()) return;
  if(!email){
    adminViewEmail=null;
    stickersData=loadCollection(STORAGE_KEYS.stickers,DEFAULT_STICKERS,normalizeSticker);
    scheduleData=loadCollection(STORAGE_KEYS.schedule,DEFAULT_SCHEDULE,normalizeClassItem);
    document.getElementById('adminBar').textContent='🔍 管理员视角：自己';
    showToast('已切回自己的数据');render();return;
  }
  const {data,error}=await sb.from('user_data').select('*').eq('user_email',email).single();
  if(error||!data){showToast('该用户暂无云端记录，可直接在输入框填 email 清空');return;}
  adminViewEmail=email;
  stickersData=(data.stickers||[]).map(normalizeSticker);
  scheduleData=(data.schedule||[]).map(normalizeClassItem);
  document.getElementById('adminBar').textContent='🔍 正在查看：'+email+' （点此切回自己）';
  showToast('已切换到：'+email);render();
}

async function injectAdminUI(){
  if(!isAdmin()) return;
  const users=await adminLoadUsers();
  const bar=document.createElement('div');
  bar.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#1c211a;color:#fff;padding:8px 16px;display:flex;align-items:center;gap:10px;z-index:200;font-size:13px;font-family:inherit';
  bar.innerHTML=`<span id="adminBar" style="flex:1;font-weight:900;cursor:pointer" onclick="adminSwitchTo(null)">🔍 管理员视角：自己</span>
    <select id="adminUserSelect" style="padding:5px 10px;border-radius:8px;border:1px solid #555;background:#2a3028;color:#fff;font-size:12px" onchange="adminSwitchTo(this.value)">
      <option value="">— 切换查看用户 —</option>
      ${users.filter(u=>u.user_email!==currentUser.email).map(u=>`<option value="${u.user_email}">${u.user_email}${u.display_name?' ('+u.display_name+')':''}</option>`).join('')}
    </select>
    <input id="adminEmailInput" placeholder="输入任意 email" style="padding:5px 10px;border-radius:8px;border:1px solid #555;background:#2a3028;color:#fff;font-size:12px;width:200px">
    <button onclick="adminClearByEmail()" style="padding:5px 12px;border-radius:8px;border:none;background:#8b2020;color:#fff;font-size:12px;cursor:pointer;font-weight:900">清空该账号数据</button>
    <button onclick="adminRefreshUsers()" style="padding:5px 10px;border-radius:8px;border:none;background:#2a5c3f;color:#fff;font-size:12px;cursor:pointer;font-weight:900">刷新用户列表</button>`;
  document.body.appendChild(bar);
  // 给主应用加底部 padding 避免被遮住
  document.getElementById('appShell').style.paddingBottom='48px';
}
async function adminClearByEmail(){
  const input=document.getElementById('adminEmailInput');
  const target=(input&&input.value.trim())||adminViewEmail||currentUser.email;
  if(!target){showToast('请先输入要清空的 email');return;}
  if(!confirm('确认清空 '+target+' 的所有班级、话术和待办？此操作不可撤销。')) return;
  await sb.from('user_data').upsert({user_email:target,stickers:[],schedule:[],todos:{},updated_at:new Date().toISOString()},{onConflict:'user_email'});
  if(target===currentUser.email){
    Object.values(STORAGE_KEYS).forEach(k=>localStorage.removeItem(k));
    localStorage.removeItem(DAILY_TODO_KEY);
    stickersData=[];scheduleData=[];
    render();
  }
  if(input) input.value='';
  showToast('已清空 '+target+' 的所有数据');
}
/* ===== END 管理员功能 ===== */

async function loadUserDataFromCloud(){
  // 先请求云端数据，确认成功后才清空本地；请求失败时返回 false，
  // 避免后续 syncToCloud 把空数组写回云端导致数据丢失
  const {data,error}=await sb.from('user_data').select('*').eq('user_email',currentUser.email).maybeSingle();
  if(error){
    console.warn('load from cloud failed',error);
    return false;
  }
  Object.values(STORAGE_KEYS).forEach(k=>localStorage.removeItem(k));
  localStorage.removeItem(DAILY_TODO_KEY);
  stickersData=[];
  scheduleData=[];
  if(data){
    localStorage.setItem(STORAGE_KEYS.stickers,JSON.stringify(data.stickers||[]));
    localStorage.setItem(STORAGE_KEYS.schedule,JSON.stringify(data.schedule||[]));
    // 云端 todos 可能是历史坏格式（字符串/数组），先归一成对象再落地
    let cloudTodos=data.todos;
    if(typeof cloudTodos==="string"){try{cloudTodos=JSON.parse(cloudTodos);}catch(e){cloudTodos={};}}
    if(!cloudTodos||typeof cloudTodos!=="object"||Array.isArray(cloudTodos)) cloudTodos={};
    localStorage.setItem(DAILY_TODO_KEY,JSON.stringify(cloudTodos));
    stickersData=(data.stickers||[]).map(normalizeSticker);
    scheduleData=(data.schedule||[]).map(normalizeClassItem);
    if(data.stickerCategories&&Array.isArray(data.stickerCategories)&&data.stickerCategories.length){
      localStorage.setItem(STORAGE_KEYS.stickerCategories,JSON.stringify(data.stickerCategories));
      stickerCategories=data.stickerCategories.map(normalizeCategory);
    }
    if(data.courseCategories&&Array.isArray(data.courseCategories)&&data.courseCategories.length){
      localStorage.setItem(STORAGE_KEYS.courseCategories,JSON.stringify(data.courseCategories));
      courseCategories=data.courseCategories.map(normalizeCategory);
    }
  }
  return true;
}

async function syncToCloud(){
  if(!currentUser)return;
  try{
    const todos=readDailyTodos();
    await sb.from('user_data').upsert({
      user_email:currentUser.email,
      stickers:stickersData,
      schedule:scheduleData,
      todos:todos,
      updated_at:new Date().toISOString()
    },{onConflict:'user_email'});
  }catch(e){
    console.warn('sync failed',e);
    showToast('⚠️ 云端同步失败，请检查网络连接');
  }
}
/* ===== END SUPABASE ===== */

const DEFAULT_STICKERS = []
const SCENARIOS = DEFAULT_STICKERS;
const DEFAULT_STICKER_CATEGORIES = [
  {
    "id": "cat-01",
    "name": "群提醒",
    "color": "#fff0bd"
  },
  {
    "id": "cat-02",
    "name": "家长",
    "color": "#ffd9cb"
  },
  {
    "id": "cat-03",
    "name": "Teacher",
    "color": "#e6ddff"
  },
  {
    "id": "cat-04",
    "name": "学生",
    "color": "#d8f0df"
  },
  {
    "id": "cat-05",
    "name": "文档技术",
    "color": "#d9eff6"
  },
  {
    "id": "cat-06",
    "name": "明日提醒",
    "color": "#ffe1ef"
  },
  {
    "id": "cat-07",
    "name": "AI提示",
    "color": "#f6eddf"
  }
];
const DEFAULT_SCHEDULE = []
const DEFAULT_COURSE_CATEGORIES = [
  {
    "id": "course-01",
    "name": "英文精读",
    "color": "#d9eff6"
  },
  {
    "id": "course-02",
    "name": "创意写作",
    "color": "#ffe1ef"
  },
  {
    "id": "course-03",
    "name": "思辨写作",
    "color": "#efe5ff"
  },
  {
    "id": "course-04",
    "name": "中文阅读营",
    "color": "#fff0bd"
  },
  {
    "id": "course-05",
    "name": "1对1",
    "color": "#d8f0df"
  },
  {
    "id": "course-06",
    "name": "其他",
    "color": "#f6eddf"
  }
];
const PRESET_COLORS = ["#fff0bd","#ffd9cb","#e6ddff","#d8f0df","#d9eff6","#ffe1ef","#f6eddf","#d9f1ee","#f3e0c7","#e8f2c9"];
const STORAGE_KEYS = {stickers:"stickersData", schedule:"scheduleData", stickerCategories:"stickerCategories", courseCategories:"courseCategories"};
const SCENES = ["before","during","after","ai"];
const SCENE_LABELS = {before:"\u8bfe\u524d", during:"\u8bfe\u4e2d", after:"\u8bfe\u540e", ai:"AI"};
const AUDIENCES = ["group","parent","teacher","student","doc","ai"];
const AUDIENCE_FILTERS = ["group","parent","teacher","student","doc"];
const AUDIENCE_LABELS = {group:"\u7fa4\u91cc", parent:"\u5bb6\u957f", teacher:"\u8001\u5e08", student:"\u5b66\u751f", doc:"\u6587\u6863", ai:"AI"};
const STATUS_LABELS = {Active:"\u8fdb\u884c\u4e2d", Paused:"\u6682\u505c", Archived:"\u5f52\u6863", Deleted:"\u56de\u6536\u7ad9"};
const WEEKDAYS = ["\u5468\u65e5","\u5468\u4e00","\u5468\u4e8c","\u5468\u4e09","\u5468\u56db","\u5468\u4e94","\u5468\u516d"];
const WORKDAYS = ["\u5468\u4e00","\u5468\u4e8c","\u5468\u4e09","\u5468\u56db","\u5468\u4e94","\u5468\u516d","\u5468\u65e5"];
let view = "today", range = "today", quickScene = "auto", quickAudience = "all", libraryScene = "all", libraryAudience = "all", manageMode = "home";
let selectedClassId = null, editingStickerId = null, editingClassId = null, cardSize = "compact", scheduleMode = "week", manageStickerScene = "all", manageStickerAudience = "all";
let stickerCategories = loadCollection(STORAGE_KEYS.stickerCategories, DEFAULT_STICKER_CATEGORIES, normalizeCategory);
let courseCategories = loadCollection(STORAGE_KEYS.courseCategories, DEFAULT_COURSE_CATEGORIES, normalizeCategory);
let stickersData = loadCollection(STORAGE_KEYS.stickers, DEFAULT_STICKERS, normalizeSticker);
let scheduleData = loadCollection(STORAGE_KEYS.schedule, DEFAULT_SCHEDULE, normalizeClassItem);
function uid(prefix){return prefix+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7);}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
function safeAttr(s){return esc(s).replace(/`/g,"&#096;");}
function byId(id){return document.getElementById(id);}
function normalizeCategory(x,i=0){return {id:x.id||uid("cat"),name:x.name||"\u672a\u5206\u7c7b",color:x.color||PRESET_COLORS[i%PRESET_COLORS.length]};}
function sceneFromStage(stage){return SCENES.includes(stage)?stage:"before";}
function audienceFromCategory(cat){if(cat==="\u5bb6\u957f")return "parent";if(cat==="Teacher"||cat==="\u8001\u5e08")return "teacher";if(cat==="\u5b66\u751f")return "student";if(cat==="\u6587\u6863\u6280\u672f"||cat==="\u6587\u6863")return "doc";if(cat==="AI\u63d0\u793a"||cat==="AI\u5de5\u5177")return "ai";return "group";}
function normalizeSticker(x){const scene=x.scene||sceneFromStage(x.stage);const audience=x.audience||audienceFromCategory(x.category||x.cat);const text=x.content??x.text??"";const tag=x.tags||x.type||"";return {id:x.id||uid("sticker"),scene,audience,stage:scene,category:x.category||x.cat||AUDIENCE_LABELS[audience]||"\u7fa4",cat:x.cat||x.category||AUDIENCE_LABELS[audience]||"\u7fa4",title:x.title||"\u672a\u547d\u540d\u8bdd\u672f",content:text,text,tags:tag,type:tag,note:x.note||"",archivedAt:x.archivedAt||"",deletedAt:x.deletedAt||""};}
function normalizeStudent(s){return typeof s==="string"?{id:uid("student"),name:s,note:""}:{id:s.id||uid("student"),name:s.name||"\u672a\u547d\u540d\u5b66\u751f",note:s.note||""};}
function normalizeNote(n){const now=new Date().toISOString();return {id:n.id||uid("note"),text:n.text||"",createdAt:n.createdAt||now,updatedAt:n.updatedAt||n.createdAt||now};}
function normalizeClassStatus(s){if(s==="Inactive")return "Paused";return ["Active","Paused","Archived","Deleted"].includes(s)?s:"Active";}
function normalizeClassItem(x){return {id:x.id||uid("class"),weekday:x.weekday||"\u5468\u4e00",time:x.time||"",teacher:x.teacher||"",courseType:x.courseType||"\u82f1\u6587\u7cbe\u8bfb",className:x.className||"\u672a\u547d\u540d\u8bfe\u7a0b",status:normalizeClassStatus(x.status),term:x.term||x.semester||"",repeatMode:x.repeatMode||"weekly",repeatDays:Array.isArray(x.repeatDays)?x.repeatDays:[],repeatDates:Array.isArray(x.repeatDates)?x.repeatDates:[],students:(x.students||[]).map(normalizeStudent),notes:(x.notes||[]).map(normalizeNote),zoomLink:x.zoomLink||x.zoom||"",zoomId:x.zoomId||"",zoomLabel:x.zoomLabel||"",zoomPassword:x.zoomPassword||x.password||"",lesson:x.lesson||"",topic:x.topic||"",totalLessons:x.totalLessons||"20",startDate:x.startDate||"",homework:x.homework||"",report:x.report||"",classRecords:Array.isArray(x.classRecords)?x.classRecords:[],skippedDates:Array.isArray(x.skippedDates)?x.skippedDates:(Array.isArray(x.breakDates)?x.breakDates:[]),archivedAt:x.archivedAt||"",deletedAt:x.deletedAt||""};}
function loadCollection(key,fallback,normalizer){try{const raw=localStorage.getItem(key);if(!raw)return fallback.map(normalizer);const parsed=JSON.parse(raw);if(!Array.isArray(parsed))throw new Error("not array");return parsed.map(normalizer);}catch(e){console.warn("local data failed",key,e);return fallback.map(normalizer);}}
function saveStickers(){if(adminViewEmail)return;localStorage.setItem(STORAGE_KEYS.stickers,JSON.stringify(stickersData));syncToCloud();}
function saveSchedule(){if(adminViewEmail)return;localStorage.setItem(STORAGE_KEYS.schedule,JSON.stringify(scheduleData));syncToCloud();}
function updateClock(){const now=new Date();let h=now.getHours();const ampm=h>=12?"PM":"AM";h=h%12||12;byId("time").innerHTML=h+":"+String(now.getMinutes()).padStart(2,"0")+" <small>"+ampm+"</small>";byId("date").textContent=now.getFullYear()+"\u5e74"+(now.getMonth()+1)+"\u6708"+now.getDate()+"\u65e5 · "+WEEKDAYS[now.getDay()];}
function todayName(offset=0){const d=new Date();d.setDate(d.getDate()+offset);return WEEKDAYS[d.getDay()];}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}
function weekStart(d=new Date()){const x=new Date(d);const day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);x.setHours(0,0,0,0);return x;}
function dateLabel(d){return (d.getMonth()+1)+"/"+d.getDate();}
function monthTitle(d=new Date()){return d.getFullYear()+"年"+(d.getMonth()+1)+"月";}
function dateKey(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
function parseLocalDate(s){const m=String(s||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?new Date(Number(m[1]),Number(m[2])-1,Number(m[3])):null;}
function occurrenceInfo(cls,d){const total=Number(cls.totalLessons)||20;if(!cls.startDate)return {show:true,lesson:cls.lesson||"\u8fdb\u5ea6\u672a\u586b"};const start=parseLocalDate(cls.startDate);if(!start||d<start)return {show:false,lesson:""};const weeks=Math.floor((d-start)/(7*24*60*60*1000));if(weeks<0||weeks>=total)return {show:false,lesson:""};return {show:true,lesson:"\u7b2c "+(weeks+1)+"/"+total+" \u8bfe"};}
function classesOnDate(classes,d){return classes.filter(x=>x.weekday===WEEKDAYS[d.getDay()]).map(x=>({...x,_occurrenceDate:dateKey(d),_autoLesson:occurrenceInfo(x,d).lesson,_showOnDate:occurrenceInfo(x,d).show})).filter(x=>x._showOnDate).sort((a,b)=>timeMinutes(a.time)-timeMinutes(b.time));}
function lessonLabel(x){return x._autoLesson||x.lesson||"\u8fdb\u5ea6\u672a\u586b";}
function timeMinutes(t){const m=String(t||"").match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):9999;}
function formatTimeCN(t){const m=String(t||"").match(/^(\d{1,2}):(\d{2})/);if(!m)return "\u672a\u5b9a";let h=Number(m[1]),min=Number(m[2]);const part=h<12?"\u4e0a\u5348":h<18?"\u4e0b\u5348":"\u665a\u4e0a";const hh=h>12?h-12:h;return part+hh+"\u70b9"+(min?String(min).padStart(2,"0"):"");}
function countdownText(cls){
  if(!cls||!cls.time)return "\u672a\u5b9a\u65f6\u95f4";
  const now=new Date();
  const start=timeMinutes(cls.time);
  const occurrence=parseLocalDate(cls._occurrenceDate);
  if(occurrence){
    occurrence.setHours(Math.floor(start/60),start%60,0,0);
    const diffMin=Math.round((occurrence-now)/60000);
    if(diffMin<-90)return "\u5df2\u7ed3\u675f";
    if(diffMin<=0)return "\u4e0a\u8bfe\u4e2d";
    if(diffMin<60)return "\u8fd8\u6709 "+diffMin+" \u5206\u949f";
    if(diffMin<24*60)return "\u8fd8\u6709 "+Math.round(diffMin/60)+" \u5c0f\u65f6";
    return "\u8fd8\u6709 "+Math.ceil(diffMin/(24*60))+" \u5929";
  }
  const today=WEEKDAYS[now.getDay()],cur=now.getHours()*60+now.getMinutes();
  let dayDiff=WORKDAYS.indexOf(cls.weekday)-WORKDAYS.indexOf(today);
  if(dayDiff<0)dayDiff+=7;
  if(dayDiff>0)return "\u8fd8\u6709 "+dayDiff+" \u5929";
  const diff=start-cur;
  if(diff>60)return "\u8fd8\u6709 "+Math.round(diff/60)+" \u5c0f\u65f6";
  if(diff>0)return "\u8fd8\u6709 "+diff+" \u5206\u949f";
  if(diff>-90)return "\u4e0a\u8bfe\u4e2d";
  return "\u5df2\u7ed3\u675f";
}
function zoomName(x){return x.zoomLabel||x.zoomId||x.zoomLink||"";}
function activeClasses(){return scheduleData.filter(x=>x.status==="Active").sort((a,b)=>WORKDAYS.indexOf(a.weekday)-WORKDAYS.indexOf(b.weekday)||timeMinutes(a.time)-timeMinutes(b.time));}
function demoClasses(){const base=[["09:00","\u4e2d\u6587\u8da3\u5473 6\u7ea7","\u6e05\u6ee2\u8001\u5e08","\u7b2c 8/20 \u8bfe","\u300a\u897f\u987f\u52a8\u7269\u6545\u4e8b\u300b","Zoom 2"],["15:00","\u82f1\u6587\u7cbe\u8bfb HP3","Teacher Chris","\u7b2c 3/20 \u8bfe","Prisoner of Azkaban","zoom1"],["17:00","\u82f1\u6587\u7cbe\u8bfb 2-3\u7ea7","Teacher Joe","\u7b2c 6/20 \u8bfe","The Giver","camp"],["18:00","\u521b\u610f\u5199\u4f5c\u5c0f\u7ec4","Teacher Louise","\u7b2c 9/20 \u8bfe","Travel Story","camp"],["19:00","\u601d\u8fa8\u8bae\u8bba\u6587 1&2\u7ea7","Teacher Alex","\u7b2c 7/20 \u8bfe","Personal Voice","siyanci"],["20:00","\u8bba\u6587\u5199\u4f5c 5\u7ea7","Teacher Ben","\u7b2c 5/20 \u8bfe","Climate Change","siyanci"]];return base.map((x,i)=>normalizeClassItem({id:"demo-"+i,weekday:"\u5468\u4e00",time:x[0],className:x[1],teacher:x[2],courseType:x[1].split(" ")[0],lesson:x[3],topic:x[4],zoomLabel:x[5],zoomLink:"https://zoom.us/",students:[{name:"Annika"},{name:"Chester"},{name:"Yolanda"}],homework:"\u9605\u8bfb\u4e0b\u4e00\u7ae0\uff0c\u5b8c\u6210\u8bfe\u540e\u5199\u4f5c\u4efb\u52a1\u3002",report:"\u8fd9\u662f\u6f14\u793a\u8bfe\u7a0b\uff0c\u7528\u6765\u68c0\u67e5\u4e00\u5929 6 \u8282\u8bfe\u7684\u6eda\u52a8\u6548\u679c\u3002"}));}
function displayClasses(){return activeClasses();}
function classesForRange(){const list=activeClasses();if(range==="week")return list;const day=range==="tomorrow"?todayName(1):todayName(0);const direct=list.filter(x=>x.weekday===day);if(direct.length||range==="tomorrow")return direct;return list.slice(0,4);}
function currentScene(cls){if(!cls)return "before";if(cls.weekday!==todayName(0))return "before";const now=new Date();const n=now.getHours()*60+now.getMinutes();const start=timeMinutes(cls.time);if(n<start-20)return "before";if(n<=start+90)return "during";return "after";}
function pickCurrentClass(list){if(selectedClassId&&list.some(x=>x.id===selectedClassId))return list.find(x=>x.id===selectedClassId);const today=list.filter(x=>x.weekday===todayName(0));const base=today.length?today:list;const now=new Date();const n=now.getHours()*60+now.getMinutes();return base.slice().sort((a,b)=>Math.abs(timeMinutes(a.time)-n)-Math.abs(timeMinutes(b.time)-n))[0]||null;}
function stickerPool(){return stickersData.filter(x=>!x.deletedAt&&!x.archivedAt);}
function filterStickers(list,scene,audience){return list.filter(x=>(scene==="all"||scene==="auto"||x.scene===scene)&&(audience==="all"||x.audience===audience));}
function updateNav(){document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===view));}
function setHead(title,sub,count){byId("viewTitle").textContent=title;byId("viewSubtitle").textContent=sub;byId("viewSubtitle").hidden=!sub;byId("counter").textContent=count||"";}
function tabs(items,current,key){return items.map(x=>`<button class="tab ${x.value===current?'active':''}" data-${key}="${safeAttr(x.value)}">${esc(x.label)}</button>`).join("");}
function render(){updateNav();if(view==="today")renderToday();if(view==="stickers")renderStickers();if(view==="manage")renderManage();}
function renderToday(){const classes=displayClasses();const labels={today:["\u4eca\u5929","\u4eca\u5929\u8bfe\u7a0b\u548c\u6700\u8fd1\u8981\u505a\u7684\u4e8b"],week:["\u672c\u5468","\u5468\u4e00\u5230\u5468\u65e5\uff0c\u6bcf\u5929\u4e00\u5f20\u5c0f\u65e5\u5386\u5361"],month:["\u6708\u5386",monthTitle()+" \u8bfe\u7a0b\u603b\u89c8"]};setHead(labels[scheduleMode][0],labels[scheduleMode][1],classes.length+" classes");byId("tabs").innerHTML=`<div class="schedule-switch">${tabs([{value:"today",label:"\u4eca\u5929"},{value:"week",label:"\u672c\u5468"},{value:"month",label:"\u6708\u5386"}],scheduleMode,"scheduleMode")}</div>`;if(scheduleMode==="today")byId("content").innerHTML=renderTodayDesk(classes);if(scheduleMode==="week")byId("content").innerHTML=renderWeekCards(classes);if(scheduleMode==="month")byId("content").innerHTML=renderMonthCalendar(classes);bindTodayEvents();bindScheduleCards(classes);}
function renderFocus(current,suggested){if(!current)return `<div class="panel-head"><h3>\u5f53\u524d\u4efb\u52a1</h3><span>\u6682\u65e0\u8bfe\u7a0b</span></div><p class="empty">\u4eca\u5929\u6ca1\u6709\u8bfe\u65f6\uff0c\u5de5\u4f5c\u53f0\u4f1a\u81ea\u52a8\u663e\u793a\u6700\u8fd1\u7684\u8fdb\u884c\u4e2d\u8bfe\u7a0b\u3002</p>`;return `<div class="panel-head"><h3>\u5f53\u524d\u4efb\u52a1</h3><span>\u5efa\u8bae\uff1a${SCENE_LABELS[suggested]}</span></div><div class="focus-card"><div class="focus-top"><div><div class="course-time">${esc(current.time||"\u672a\u5b9a")}</div><div class="course-name">${esc(current.className)}</div></div><span class="chip ok">${STATUS_LABELS[current.status]}</span></div><div class="meta-row"><span class="chip">${esc(current.weekday)}</span><span class="chip">${esc(current.courseType)}</span><span class="chip">${esc(current.teacher||"\u672a\u586b\u8001\u5e08")}</span></div><div class="student-row">${current.students.map(s=>`<span class="chip">${esc(s.name)}</span>`).join("")||'<span class="chip">\u6682\u65e0\u5b66\u751f</span>'}</div><div class="course-note">${esc((current.notes[0]&&current.notes[0].text)||"\u6682\u65e0\u5907\u6ce8\u3002")}</div></div>`;}
function renderCourseCards(classes,current){return `<div class="course-card-grid">${classes.map(x=>renderScheduleCard(x,current&&x.id===current.id)).join("")||'<p class="empty">\u6682\u65e0\u53ef\u663e\u793a\u8bfe\u7a0b\u3002</p>'}</div>`;}
function renderTodayDesk(classes){const now=new Date(),today=classesOnDate(classes,now);const upcoming=classes.slice().sort((a,b)=>{const da=(WORKDAYS.indexOf(a.weekday)-WORKDAYS.indexOf(todayName(0))+7)%7,db=(WORKDAYS.indexOf(b.weekday)-WORKDAYS.indexOf(todayName(0))+7)%7;return da-db||timeMinutes(a.time)-timeMinutes(b.time);}).slice(0,5);return `<div class="today-desk"><section class="today-card"><div class="calendar-stub"><span>${monthTitle(now)}</span><b>${now.getDate()}</b><em>${todayName(0)}</em></div><div><h3>\u4eca\u5929</h3><p>${today.length?"\u4eca\u5929\u6709 "+today.length+" \u8282\u8bfe":"\u4eca\u5929\u6ca1\u6709\u8bfe"}</p></div></section><section class="today-list"><div class="panel-head"><h3>\u4eca\u5929\u8bfe\u7a0b</h3><span>${today.length} \u8282</span></div>${today.map(x=>renderScheduleCard(x,false)).join("")||'<p class="empty">\u4eca\u5929\u6ca1\u6709\u8bfe\u3002</p>'}</section><section class="today-list soft"><div class="panel-head"><h3>\u6700\u8fd1\u8bfe\u7a0b</h3><span>\u5feb\u901f\u67e5\u770b</span></div>${upcoming.map(x=>renderScheduleCard(x,false)).join("")}</section></div>`;}
function renderDayColumn(day,items){return `<section class="week-day-card"><div class="day-card-head"><b>${esc(day)}</b><span>${items.length} \u8282</span></div><div class="day-card-list">${items.map(x=>renderScheduleCard(x,false)).join("")||'<p class="empty mini">\u6ca1\u8bfe</p>'}</div></section>`;}
function renderWeekCards(classes){const start=weekStart();return `<div class="week-card-grid">${WORKDAYS.map((day,i)=>{const d=addDays(start,i),items=classesOnDate(classes,d);return `<section class="week-day-card ${day===todayName(0)?'today':''}"><div class="day-card-head"><div><b>${esc(day)}</b><small>${dateLabel(d)}</small></div><span>${items.length} \u8282</span></div><div class="day-card-list">${items.map(x=>renderScheduleCard(x,false)).join("")||'<p class="empty mini">\u6ca1\u8bfe</p>'}</div></section>`;}).join("")}</div>`;}
function renderMonthCalendar(classes){const now=new Date(),first=new Date(now.getFullYear(),now.getMonth(),1),last=new Date(now.getFullYear(),now.getMonth()+1,0),offset=(first.getDay()+6)%7,start=addDays(first,-offset),cellCount=Math.ceil((offset+last.getDate())/7)*7;const cells=Array.from({length:cellCount},(_,i)=>addDays(start,i));return `<div class="month-calendar"><div class="month-weekdays">${WORKDAYS.map(d=>`<b>${esc(d.replace("\u5468",""))}</b>`).join("")}</div><div class="month-grid" style="grid-template-rows:repeat(${Math.ceil(cellCount/7)},minmax(0,1fr))">${cells.map(d=>{const muted=d.getMonth()!==now.getMonth(),items=muted?[]:classesOnDate(classes,d),today=d.toDateString()===now.toDateString();return `<section class="month-cell ${muted?'muted':''} ${today?'today':''}"><div class="month-date"><b>${muted?'':d.getDate()}</b><span>${items.length?items.length+" \u8282":""}</span></div><div class="month-class-list">${items.map(x=>renderMonthCourse(x)).join("")}</div></section>`;}).join("")}</div></div>`;}
function renderMonthCourse(x){return `<button class="month-course" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button"><b>${esc(formatTimeCN(x.time))}</b><span>${esc(x.className)}</span><em>${esc(zoomName(x)||lessonLabel(x))}</em></button>`;}
function renderScheduleCard(x,active){const zoom=zoomName(x);return `<button class="schedule-card ${active?'active':''}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button"><div class="course-card-top"><span class="mini-time">${esc(formatTimeCN(x.time))}</span><span class="countdown-pill">${esc(countdownText(x))}</span></div><b>${esc(x.className)}</b><small>${esc(x.teacher||"\u672a\u586b\u8001\u5e08")}</small><em>${zoom?esc(zoom):"\u672a\u586b Zoom"} · ${esc(lessonLabel(x))}</em></button>`;}
function bindScheduleCards(list=displayClasses()){document.querySelectorAll("[data-schedule-id]").forEach(btn=>btn.addEventListener("click",()=>{let item=list.find(x=>x.id===btn.dataset.scheduleId)||scheduleData.find(x=>x.id===btn.dataset.scheduleId);const d=parseLocalDate(btn.dataset.occurrenceDate);if(item&&d)item=classesOnDate([item],d)[0]||item;if(item)openClassDetailModal(item);}));}
function classDetailText(item){return `\u8001\u5e08\uff1a${item.teacher||"\u672a\u586b"}\n\u5b66\u751f\uff1a${item.students.map(s=>s.name).join("\u3001")||"\u6682\u65e0"}\n\u8bfe\u7a0b\uff1a${item.courseType||"\u672a\u586b"}\n\u8fdb\u5ea6\uff1a${lessonLabel(item)}\n\u4e3b\u9898\uff1a${item.topic||"\u672a\u586b"}\n\nZoom\u8d26\u53f7\uff1a${zoomName(item)||"\u672a\u586b"}\nZoom\u94fe\u63a5\uff1a${item.zoomLink||"\u672a\u586b"}\n\u4f1a\u8bae\u53f7\uff1a${item.zoomId||"\u672a\u586b"}\n\u5bc6\u7801\uff1a${item.zoomPassword||"\u672a\u586b"}\n\n\u4e0a\u5468\u4f5c\u4e1a\uff1a${item.homework||"\u672a\u586b"}\n\n\u8bfe\u5802\u8bb0\u5f55\uff1a${item.report||(item.notes[0]&&item.notes[0].text)||"\u672a\u586b"}`;}
function classDetailHtml(item){const rows=[["\u8001\u5e08",item.teacher],["\u5b66\u751f",item.students.map(s=>s.name).join("\u3001")],["\u8bfe\u7a0b",item.courseType],["\u8fdb\u5ea6",lessonLabel(item)],["\u4e3b\u9898",item.topic],["Zoom \u8d26\u53f7",zoomName(item)],["Zoom \u94fe\u63a5",item.zoomLink],["\u4f1a\u8bae\u53f7",item.zoomId],["\u5bc6\u7801",item.zoomPassword]];return `<div class="detail-grid">${rows.map(([k,v])=>`<div class="detail-line"><span>${k}</span><b>${esc(v||"\u672a\u586b")}</b></div>`).join("")}</div><div class="detail-note"><span>\u4e0a\u5468\u4f5c\u4e1a</span><p>${esc(item.homework||"\u672a\u586b")}</p></div><div class="detail-note"><span>\u8bfe\u5802\u8bb0\u5f55</span><p>${esc(item.report||(item.notes[0]&&item.notes[0].text)||"\u672a\u586b")}</p></div>`;}
function openClassDetailModal(item){const isDemo=String(item.id||"").startsWith("demo-");byId("detailTags").innerHTML=`<span class="scene-tag">${esc(item.weekday)}</span><span class="audience-tag">${STATUS_LABELS[item.status]}</span><span class="audience-tag">${esc(countdownText(item))}</span>`;byId("detailTitle").textContent=(item.time?formatTimeCN(item.time)+" · ":"")+item.className;byId("detailContent").innerHTML=classDetailHtml(item);byId("detailOpenZoom").hidden=!item.zoomLink;byId("detailOpenZoom").onclick=()=>{if(item.zoomLink)window.open(item.zoomLink,"_blank");};byId("detailEdit").hidden=isDemo;byId("detailEdit").textContent="\u7f16\u8f91";byId("detailEdit").onclick=isDemo?null:()=>renderClassInlineEditor(item);byId("detailCopy").textContent="\u590d\u5236\u8bfe\u7a0b\u8be6\u60c5";byId("detailCopy").onclick=()=>copyText(classDetailText(item));byId("detailModal").classList.add("show");byId("detailModal").setAttribute("aria-hidden","false");}
function renderClassInlineEditor(item){byId("detailTags").innerHTML=`<span class="scene-tag">${esc(item.weekday)}</span><span class="audience-tag">\u76f4\u63a5\u7f16\u8f91</span>`;byId("detailTitle").textContent="\u7f16\u8f91\uff1a"+item.className;byId("detailContent").innerHTML=`<div class="detail-form"><label>\u661f\u671f<select id="modalWeekday">${WORKDAYS.map(v=>`<option value="${v}" ${item.weekday===v?'selected':''}>${v}</option>`).join("")}</select></label><label>\u65f6\u95f4<input id="modalTime" type="time" value="${safeAttr(item.time)}"></label><label>\u8bfe\u7a0b\u540d<input id="modalName" value="${safeAttr(item.className)}"></label><label>\u8001\u5e08<input id="modalTeacher" value="${safeAttr(item.teacher)}"></label><label>\u8bfe\u7a0b\u7c7b\u578b<input id="modalType" value="${safeAttr(item.courseType)}"></label><label>\u72b6\u6001<select id="modalStatus">${["Active","Paused","Archived"].map(v=>`<option value="${v}" ${item.status===v?'selected':''}>${STATUS_LABELS[v]}</option>`).join("")}</select></label><label>\u7b2c\u51e0\u8bfe<input id="modalLesson" value="${safeAttr(item.lesson)}"></label><label>\u672c\u5468\u4e3b\u9898<input id="modalTopic" value="${safeAttr(item.topic)}"></label><label>Zoom \u8d26\u53f7<input id="modalZoomLabel" value="${safeAttr(item.zoomLabel)}"></label><label>Zoom \u94fe\u63a5<input id="modalZoomLink" value="${safeAttr(item.zoomLink)}"></label><label>Zoom ID<input id="modalZoomId" value="${safeAttr(item.zoomId)}"></label><label>Zoom \u5bc6\u7801<input id="modalZoomPassword" value="${safeAttr(item.zoomPassword)}"></label><label class="wide">\u5b66\u751f<textarea id="modalStudents">${esc((item.students||[]).map(s=>s.name+(s.note?' | '+s.note:'')).join('\n'))}</textarea></label><label class="wide">\u4e0a\u5468\u4f5c\u4e1a<textarea id="modalHomework">${esc(item.homework||"")}</textarea></label><label class="wide">\u8bfe\u5802\u8bb0\u5f55<textarea id="modalReport">${esc(item.report||(item.notes[0]&&item.notes[0].text)||"")}</textarea></label></div>`;byId("detailOpenZoom").hidden=true;byId("detailEdit").hidden=false;byId("detailEdit").textContent="\u53d6\u6d88";byId("detailEdit").onclick=()=>openClassDetailModal(item);byId("detailCopy").textContent="\u4fdd\u5b58\u8bfe\u7a0b";byId("detailCopy").onclick=()=>saveInlineClass(item.id);}
function saveInlineClass(id){const existing=scheduleData.find(x=>x.id===id);if(!existing)return;const report=byId("modalReport").value.trim();const item=normalizeClassItem({...existing,weekday:byId("modalWeekday").value,time:byId("modalTime").value,className:byId("modalName").value||"\u672a\u547d\u540d\u8bfe\u7a0b",teacher:byId("modalTeacher").value,courseType:byId("modalType").value,status:byId("modalStatus").value,lesson:byId("modalLesson").value,topic:byId("modalTopic").value,zoomLabel:byId("modalZoomLabel").value,zoomLink:byId("modalZoomLink").value,zoomId:byId("modalZoomId").value,zoomPassword:byId("modalZoomPassword").value,students:parseStudents(byId("modalStudents").value),homework:byId("modalHomework").value,report});if(report){if(item.notes[0]){item.notes[0].text=report;item.notes[0].updatedAt=new Date().toISOString();}else item.notes.unshift({id:uid("note"),text:report,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});}const idx=scheduleData.findIndex(x=>x.id===id);scheduleData[idx]={...scheduleData[idx],...item};saveSchedule();showToast("\u5df2\u4fdd\u5b58\u8bfe\u7a0b");if(view==="today")render();openClassDetailModal(scheduleData[idx]);}
function filterBar(prefix,scene,audience,auto=false){const sceneItems=[...(auto?[{value:"auto",label:"\u81ea\u52a8"}]:[]),{value:"all",label:"\u5168\u90e8"},...SCENES.map(x=>({value:x,label:SCENE_LABELS[x]}))];const audItems=[{value:"all",label:"\u5168\u90e8"},...AUDIENCE_FILTERS.map(x=>({value:x,label:AUDIENCE_LABELS[x]}))];return `<div class="filter-line"><span class="filter-label">\u9636\u6bb5</span>${tabs(sceneItems,scene,prefix+"Scene")}</div><div class="filter-line"><span class="filter-label">\u53d1\u7ed9</span>${tabs(audItems,audience,prefix+"Audience")}</div>`;}
function renderStickers(){const list=filterStickers(stickerPool(),libraryScene,libraryAudience);setHead("\u8bdd\u672f","\u50cf\u4fbf\u7b7e\u8d44\u6599\u5e93\u4e00\u6837\u627e\u548c\u590d\u5236",list.length+" stickers");byId("tabs").innerHTML="";byId("content").innerHTML=`<div class="library-tools"><div class="filter-panel">${filterBar("library",libraryScene,libraryAudience)}</div><div class="size-switch">${tabs([{value:"compact",label:"\u5bc6\u96c6"},{value:"normal",label:"\u8212\u5c55"}],cardSize,"cardSize")}</div></div><div class="library-grid ${cardSize==="compact"?'compact':''}">${list.map(renderStickerCard).join("")||'<p class="empty">\u6ca1\u6709\u5339\u914d\u7684\u8bdd\u672f\u3002</p>'}</div>`;bindLibraryEvents();bindCopy(list);bindDetail(list);}
function renderStickerCard(x){const audience=x.scene==="ai"&&x.audience==="ai"?"":`<span class="audience-tag">${AUDIENCE_LABELS[x.audience]}</span>`;return `<article class="sticker-card"><button class="sticker-open" data-detail-id="${safeAttr(x.id)}" type="button"><div class="tag-row"><span class="scene-tag">${SCENE_LABELS[x.scene]}</span>${audience}</div><b>${esc(x.title)}</b><p>${esc(x.content)}</p></button><button class="copy-badge" data-copy-id="${safeAttr(x.id)}" type="button">\u590d\u5236</button></article>`;}
function bindCopy(list){document.querySelectorAll("[data-copy-id]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();const item=list.find(x=>x.id===btn.dataset.copyId);if(item)copyText(item.content);}));}
function bindDetail(list){document.querySelectorAll("[data-detail-id]").forEach(btn=>btn.addEventListener("click",()=>{const item=list.find(x=>x.id===btn.dataset.detailId);if(item)openStickerDetail(item);}));}
function openStickerDetail(item){byId("detailTags").innerHTML=`<span class="scene-tag">${SCENE_LABELS[item.scene]}</span>${item.audience==="ai"&&item.scene==="ai"?"":`<span class="audience-tag">${AUDIENCE_LABELS[item.audience]}</span>`}`;byId("detailTitle").textContent=item.title;byId("detailContent").textContent=item.content;byId("detailOpenZoom").hidden=true;byId("detailEdit").hidden=true;byId("detailCopy").textContent="\u590d\u5236\u8fd9\u6761\u8bdd\u672f";byId("detailCopy").onclick=()=>copyText(item.content);byId("detailModal").classList.add("show");byId("detailModal").setAttribute("aria-hidden","false");}
function closeStickerDetail(){byId("detailModal").classList.remove("show");byId("detailModal").setAttribute("aria-hidden","true");document.body.focus();}
function bindTodayEvents(){document.querySelectorAll("[data-scheduleMode]").forEach(b=>b.addEventListener("click",()=>{scheduleMode=b.dataset.schedulemode;render();}));document.querySelectorAll("[data-range]").forEach(b=>b.addEventListener("click",()=>{range=b.dataset.range;selectedClassId=null;render();}));document.querySelectorAll("[data-class-pick]").forEach(b=>b.addEventListener("click",()=>{selectedClassId=b.dataset.classPick;render();}));document.querySelectorAll("[data-quickScene]").forEach(b=>b.addEventListener("click",()=>{quickScene=b.dataset.quickscene;render();}));document.querySelectorAll("[data-quickAudience]").forEach(b=>b.addEventListener("click",()=>{quickAudience=b.dataset.quickaudience;render();}));}
function bindLibraryEvents(){document.querySelectorAll("[data-libraryScene]").forEach(b=>b.addEventListener("click",()=>{libraryScene=b.dataset.libraryscene;render();}));document.querySelectorAll("[data-libraryAudience]").forEach(b=>b.addEventListener("click",()=>{libraryAudience=b.dataset.libraryaudience;render();}));document.querySelectorAll("[data-cardSize]").forEach(b=>b.addEventListener("click",()=>{cardSize=b.dataset.cardsize;render();}));}
function renderManage(){setHead("\u7ba1\u7406","\u5206\u6b65\u6574\u7406\u8bdd\u672f\u3001\u8bfe\u7a0b\u3001\u56de\u6536\u7ad9\u548c\u5907\u4efd","");byId("tabs").innerHTML=tabs([{value:"home",label:"\u5165\u53e3"},{value:"stickers",label:"\u7ba1\u7406\u8bdd\u672f"},{value:"classes",label:"\u7ba1\u7406\u8bfe\u7a0b"},{value:"trash",label:"\u56de\u6536\u7ad9"},{value:"backup",label:"\u5907\u4efd"}],manageMode,"manage");if(manageMode==="home")renderManageHome();if(manageMode==="stickers")renderStickerManage();if(manageMode==="classes")renderClassManage();if(manageMode==="trash")renderTrash();if(manageMode==="backup")renderBackup();bindManageEvents();}
function renderManageHome(){byId("content").innerHTML=`<div class="manage-home compact"><button class="manage-card" data-manage-go="stickers"><b>\u8bdd\u672f</b><p>\u65b0\u589e / \u4fee\u6539 / \u5f52\u6863</p></button><button class="manage-card" data-manage-go="classes"><b>\u8bfe\u7a0b</b><p>\u8bfe\u8868 / Zoom / \u8fdb\u5ea6 / \u4f5c\u4e1a</p></button><button class="manage-card" data-manage-go="trash"><b>\u56de\u6536\u7ad9</b><p>\u6062\u590d\u8bef\u5220</p></button><button class="manage-card" data-manage-go="backup"><b>\u5907\u4efd</b><p>\u5bfc\u51fa\u6216\u5bfc\u5165</p></button></div>`;}
function renderStickerManage(){const list=filterStickers(stickersData.filter(x=>!x.deletedAt),manageStickerScene,manageStickerAudience);const current=stickersData.find(x=>x.id===editingStickerId)||null;byId("content").innerHTML=`<div class="manage-layout sticker-manage"><section class="list-panel"><div class="panel-head"><h3>\u627e\u8bdd\u672f</h3><button class="btn primary" data-new-sticker>\u65b0\u589e</button></div><div class="manage-filter">${filterBar("manageSticker",manageStickerScene,manageStickerAudience)}</div><div class="item-list">${list.map(x=>`<button class="list-item ${x.id===editingStickerId?'active':''}" data-edit-sticker="${safeAttr(x.id)}"><b>${esc(x.title)}</b><span>${SCENE_LABELS[x.scene]} · ${AUDIENCE_LABELS[x.audience]}${x.archivedAt?' · \u5df2\u5f52\u6863':''}</span></button>`).join("")||'<p class="empty">\u8fd9\u4e2a\u5206\u7c7b\u91cc\u6ca1\u6709\u8bdd\u672f\u3002</p>'}</div></section><section class="edit-panel">${stickerForm(current)}</section></div>`;}
function stickerForm(x){x=x||{scene:"before",audience:"group",title:"",content:"",note:""};return `<h3>${x.id?'\u7f16\u8f91\u8bdd\u672f':'\u65b0\u589e\u8bdd\u672f'}</h3><div class="form-grid"><label class="field">\u6807\u9898<input id="stickerTitle" value="${safeAttr(x.title)}"></label><label class="field">\u573a\u666f<select id="stickerScene">${SCENES.map(v=>`<option value="${v}" ${x.scene===v?'selected':''}>${SCENE_LABELS[v]}</option>`).join("")}</select></label><label class="field">\u5bf9\u8c61<select id="stickerAudience">${AUDIENCES.map(v=>`<option value="${v}" ${x.audience===v?'selected':''}>${AUDIENCE_LABELS[v]}</option>`).join("")}</select></label><label class="field">\u5907\u6ce8<input id="stickerNote" value="${safeAttr(x.note||"")}"></label><label class="field full">\u5185\u5bb9<textarea id="stickerContent">${esc(x.content||"")}</textarea></label></div><div class="form-actions"><button class="btn primary" data-save-sticker>\u4fdd\u5b58</button>${x.id?'<button class="btn ghost" data-archive-sticker>\u5f52\u6863</button><button class="btn danger" data-delete-sticker>\u5220\u9664</button>':''}</div>`;}
function renderClassManage(){const list=scheduleData.filter(x=>x.status!=="Deleted");const current=scheduleData.find(x=>x.id===editingClassId)||null;byId("content").innerHTML=`<div class="manage-layout"><section class="list-panel"><div class="panel-head"><h3>\u8bfe\u7a0b</h3><button class="btn primary" data-new-class>\u65b0\u589e</button></div><div class="item-list">${list.map(x=>`<button class="list-item ${x.id===editingClassId?'active':''}" data-edit-class="${safeAttr(x.id)}"><b>${esc(x.weekday)} ${esc(x.time)} · ${esc(x.className)}</b><span>${STATUS_LABELS[x.status]} · ${esc(x.teacher||"\u672a\u586b\u8001\u5e08")}</span></button>`).join("")}</div></section><section class="edit-panel">${classForm(current)}</section></div>`;}
function classForm(x){x=x||{weekday:"\u5468\u4e00",time:"",teacher:"",courseType:"",className:"",status:"Active",students:[],notes:[],zoomLink:"",zoomId:"",zoomLabel:"",zoomPassword:"",lesson:"",topic:"",totalLessons:"20",startDate:"",homework:"",report:""};return `<h3>${x.id?'\u7f16\u8f91\u8bfe\u7a0b':'\u65b0\u589e\u8bfe\u7a0b'}</h3><p class="form-hint">\u5148\u586b\u57fa\u672c\u4fe1\u606f\uff1b\u5f00\u8bfe\u65e5\u671f + \u603b\u8bfe\u6570\u4f1a\u81ea\u52a8\u7b97\u7b2c\u51e0\u8bfe\u3002</p><div class="form-grid game-form"><div class="form-section full"><b>\u8bfe\u7a0b\u5361</b><div class="form-grid inner"><label class="field">\u661f\u671f<select id="classWeekday">${WORKDAYS.map(v=>`<option value="${v}" ${x.weekday===v?'selected':''}>${v}</option>`).join("")}</select></label><label class="field">\u65f6\u95f4<input id="classTime" type="time" value="${safeAttr(x.time)}"></label><label class="field">\u8bfe\u7a0b\u540d<input id="className" value="${safeAttr(x.className)}" placeholder="\u5982\uff1a\u82f1\u6587\u7cbe\u8bfb HP3"></label><label class="field">\u8001\u5e08<input id="classTeacher" value="${safeAttr(x.teacher)}"></label><label class="field">\u8bfe\u7a0b\u7c7b\u578b<input id="classCourseType" value="${safeAttr(x.courseType)}" placeholder="LR / CR / CW / EW"></label><label class="field">\u72b6\u6001<select id="classStatus">${["Active","Paused","Archived"].map(v=>`<option value="${v}" ${x.status===v?'selected':''}>${STATUS_LABELS[v]}</option>`).join("")}</select></label></div></div><div class="form-section"><b>\u81ea\u52a8\u8fdb\u5ea6</b><label class="field">\u5f00\u8bfe\u65e5\u671f<input id="classStartDate" type="date" value="${safeAttr(x.startDate)}"></label><label class="field">\u603b\u8bfe\u6570<input id="classTotalLessons" value="${safeAttr(x.totalLessons)}" placeholder="20"></label><label class="field">\u672c\u5468\u4e3b\u9898<input id="classTopic" value="${safeAttr(x.topic)}" placeholder="\u5982\uff1aHarry Potter 3"></label><input id="classLesson" type="hidden" value="${safeAttr(x.lesson)}"></div><div class="form-section"><b>Zoom</b><label class="field">Zoom \u8d26\u53f7<input id="classZoomLabel" value="${safeAttr(x.zoomLabel)}" placeholder="zoom1 / zoom2 / camp / siyanci"></label><label class="field">Zoom \u94fe\u63a5<input id="classZoomLink" value="${safeAttr(x.zoomLink)}"></label><label class="field">Zoom ID<input id="classZoomId" value="${safeAttr(x.zoomId)}"></label><label class="field">Zoom \u5bc6\u7801<input id="classZoomPassword" value="${safeAttr(x.zoomPassword)}"></label></div><label class="field full">\u5b66\u751f<textarea id="classStudents" placeholder="\u6bcf\u884c\u4e00\u4e2a\u5b66\u751f\uff1b\u53ef\u5199\uff1a\u59d3\u540d | \u5907\u6ce8">${esc((x.students||[]).map(s=>s.name+(s.note?' | '+s.note:'')).join('\n'))}</textarea></label><label class="field full">\u4e0a\u5468\u4f5c\u4e1a<textarea id="classHomework">${esc(x.homework||"")}</textarea></label><label class="field full">\u8bfe\u5802\u62a5\u544a / \u81ea\u5df1\u7684\u5907\u6ce8<textarea id="classReport">${esc(x.report||(x.notes&&x.notes[0]&&x.notes[0].text)||"")}</textarea></label></div><div class="form-actions"><button class="btn primary" data-save-class>\u4fdd\u5b58</button>${x.id?'<button class="btn ghost" data-archive-class>\u5f52\u6863</button><button class="btn danger" data-delete-class>\u5220\u9664</button>':''}</div>`;}
function renderTrash(){const ss=stickersData.filter(x=>x.deletedAt), cs=scheduleData.filter(x=>x.status==="Deleted");byId("content").innerHTML=`<div class="grid-2"><section class="panel"><div class="panel-head"><h3>\u5df2\u5220\u9664\u8bdd\u672f</h3><span>${ss.length}</span></div><div class="trash-grid">${ss.map(x=>`<div class="list-item"><b>${esc(x.title)}</b><span>${SCENE_LABELS[x.scene]} · ${AUDIENCE_LABELS[x.audience]}</span><div class="form-actions"><button class="btn" data-restore-sticker="${safeAttr(x.id)}">\u6062\u590d</button><button class="btn danger" data-purge-sticker="${safeAttr(x.id)}">\u5f7b\u5e95\u5220\u9664</button></div></div>`).join("")||'<p class="empty">\u6ca1\u6709\u5df2\u5220\u9664\u8bdd\u672f\u3002</p>'}</div></section><section class="panel"><div class="panel-head"><h3>\u5df2\u5220\u9664\u8bfe\u7a0b</h3><span>${cs.length}</span></div><div class="trash-grid">${cs.map(x=>`<div class="list-item"><b>${esc(x.className)}</b><span>${esc(x.weekday)} ${esc(x.time)}</span><div class="form-actions"><button class="btn" data-restore-class="${safeAttr(x.id)}">\u6062\u590d</button><button class="btn danger" data-purge-class="${safeAttr(x.id)}">\u5f7b\u5e95\u5220\u9664</button></div></div>`).join("")||'<p class="empty">\u6ca1\u6709\u5df2\u5220\u9664\u8bfe\u7a0b\u3002</p>'}</div></section></div>`;}
function renderBackup(){byId("content").innerHTML=`<section class="panel backup-box"><div class="panel-head"><h3>\u5907\u4efd</h3><span>\u5bfc\u51fa\u540e\u53ef\u4fdd\u5b58\u5230\u672c\u5730</span></div><textarea id="backupText" placeholder="\u70b9\u51fb\u5bfc\u51fa\u540e\u4f1a\u51fa\u73b0 JSON"></textarea><div class="form-actions"><button class="btn primary" data-export-all>\u5bfc\u51fa\u5168\u90e8</button><button class="btn" data-import-all>\u5bfc\u5165</button></div></section>`;}
function bindManageEvents(){document.querySelectorAll("[data-manage]").forEach(b=>b.addEventListener("click",()=>{manageMode=b.dataset.manage;editingStickerId=null;editingClassId=null;render();}));document.querySelectorAll("[data-manage-go]").forEach(b=>b.addEventListener("click",()=>{manageMode=b.dataset.manageGo;render();}));document.querySelectorAll("[data-manageStickerScene]").forEach(b=>b.addEventListener("click",()=>{manageStickerScene=b.dataset.managestickerscene;editingStickerId=null;render();}));document.querySelectorAll("[data-manageStickerAudience]").forEach(b=>b.addEventListener("click",()=>{manageStickerAudience=b.dataset.managestickeraudience;editingStickerId=null;render();}));document.querySelectorAll("[data-edit-sticker]").forEach(b=>b.addEventListener("click",()=>{editingStickerId=b.dataset.editSticker;render();}));document.querySelectorAll("[data-new-sticker]").forEach(b=>b.addEventListener("click",()=>{editingStickerId=null;render();}));document.querySelectorAll("[data-save-sticker]").forEach(b=>b.addEventListener("click",saveStickerFromForm));document.querySelectorAll("[data-archive-sticker]").forEach(b=>b.addEventListener("click",()=>{const x=stickersData.find(s=>s.id===editingStickerId);if(x){x.archivedAt=x.archivedAt?"":new Date().toISOString();saveStickers();render();}}));document.querySelectorAll("[data-delete-sticker]").forEach(b=>b.addEventListener("click",()=>{const x=stickersData.find(s=>s.id===editingStickerId);if(x){x.deletedAt=new Date().toISOString();editingStickerId=null;saveStickers();render();}}));document.querySelectorAll("[data-edit-class]").forEach(b=>b.addEventListener("click",()=>{editingClassId=b.dataset.editClass;render();}));document.querySelectorAll("[data-new-class]").forEach(b=>b.addEventListener("click",()=>{editingClassId=null;render();}));document.querySelectorAll("[data-save-class]").forEach(b=>b.addEventListener("click",saveClassFromForm));document.querySelectorAll("[data-archive-class]").forEach(b=>b.addEventListener("click",()=>{const x=scheduleData.find(c=>c.id===editingClassId);if(x){x.status="Archived";x.archivedAt=new Date().toISOString();saveSchedule();render();}}));document.querySelectorAll("[data-delete-class]").forEach(b=>b.addEventListener("click",()=>{const x=scheduleData.find(c=>c.id===editingClassId);if(x){x.status="Deleted";x.deletedAt=new Date().toISOString();editingClassId=null;saveSchedule();render();}}));document.querySelectorAll("[data-restore-sticker]").forEach(b=>b.addEventListener("click",()=>{const x=stickersData.find(s=>s.id===b.dataset.restoreSticker);if(x){x.deletedAt="";saveStickers();render();}}));document.querySelectorAll("[data-purge-sticker]").forEach(b=>b.addEventListener("click",()=>{if(!confirm("\u786e\u5b9a\u5f7b\u5e95\u5220\u9664\u8fd9\u6761\u8bdd\u672f\u5417\uff1f"))return;stickersData=stickersData.filter(s=>s.id!==b.dataset.purgeSticker);saveStickers();render();}));document.querySelectorAll("[data-restore-class]").forEach(b=>b.addEventListener("click",()=>{const x=scheduleData.find(c=>c.id===b.dataset.restoreClass);if(x){x.status="Active";x.deletedAt="";saveSchedule();render();}}));document.querySelectorAll("[data-purge-class]").forEach(b=>b.addEventListener("click",()=>{if(!confirm("\u786e\u5b9a\u5f7b\u5e95\u5220\u9664\u8fd9\u8282\u8bfe\u5417\uff1f"))return;scheduleData=scheduleData.filter(c=>c.id!==b.dataset.purgeClass);saveSchedule();render();}));document.querySelectorAll("[data-export-all]").forEach(b=>b.addEventListener("click",()=>{byId("backupText").value=JSON.stringify({stickers:stickersData,classes:scheduleData,stickerCategories,courseCategories},null,2);showToast("\u5df2\u5bfc\u51fa");}));document.querySelectorAll("[data-import-all]").forEach(b=>b.addEventListener("click",importAll));}
function saveStickerFromForm(){const item=normalizeSticker({id:editingStickerId||uid("sticker"),scene:byId("stickerScene").value,audience:byId("stickerAudience").value,title:byId("stickerTitle").value||"\u672a\u547d\u540d\u8bdd\u672f",content:byId("stickerContent").value,note:byId("stickerNote").value});const idx=stickersData.findIndex(x=>x.id===editingStickerId);if(idx>=0)stickersData[idx]={...stickersData[idx],...item};else stickersData.push(item);editingStickerId=item.id;saveStickers();showToast("\u5df2\u4fdd\u5b58\u8bdd\u672f");render();}
function saveClassFromForm(){const report=byId("classReport").value.trim();const existing=scheduleData.find(x=>x.id===editingClassId);const item=normalizeClassItem({id:editingClassId||uid("class"),weekday:byId("classWeekday").value,time:byId("classTime").value,className:byId("className").value||"\u672a\u547d\u540d\u8bfe\u7a0b",teacher:byId("classTeacher").value,courseType:byId("classCourseType").value,status:byId("classStatus").value,students:parseStudents(byId("classStudents").value),zoomLabel:byId("classZoomLabel").value,zoomLink:byId("classZoomLink").value,zoomId:byId("classZoomId").value,zoomPassword:byId("classZoomPassword").value,lesson:byId("classLesson").value,topic:byId("classTopic").value,totalLessons:byId("classTotalLessons").value,startDate:byId("classStartDate").value,homework:byId("classHomework").value,report,notes:existing?existing.notes:[]});if(report){if(item.notes[0]){item.notes[0].text=report;item.notes[0].updatedAt=new Date().toISOString();}else item.notes.unshift({id:uid("note"),text:report,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});}const idx=scheduleData.findIndex(x=>x.id===editingClassId);if(idx>=0)scheduleData[idx]={...scheduleData[idx],...item};else scheduleData.push(item);editingClassId=item.id;saveSchedule();showToast("\u5df2\u4fdd\u5b58\u8bfe\u7a0b");render();}
function parseStudents(text){return text.split(/\n+/).map(x=>x.trim()).filter(Boolean).map(line=>{const [name,...note]=line.split("|");return {id:uid("student"),name:name.trim(),note:note.join("|").trim()};});}
function importAll(){try{const data=JSON.parse(byId("backupText").value);if(Array.isArray(data.stickers))stickersData=data.stickers.map(normalizeSticker);if(Array.isArray(data.classes))scheduleData=data.classes.map(normalizeClassItem);if(Array.isArray(data.stickerCategories)&&data.stickerCategories.length){stickerCategories=data.stickerCategories.map(normalizeCategory);localStorage.setItem(STORAGE_KEYS.stickerCategories,JSON.stringify(stickerCategories));}if(Array.isArray(data.courseCategories)&&data.courseCategories.length){courseCategories=data.courseCategories.map(normalizeCategory);localStorage.setItem(STORAGE_KEYS.courseCategories,JSON.stringify(courseCategories));}saveStickers();saveSchedule();showToast("\u5bfc\u5165\u6210\u529f");render();}catch(e){showToast("\u5bfc\u5165\u5931\u8d25\uff0c\u8bf7\u786e\u8ba4\u683c\u5f0f\uff1aJSON \u5305\u542b stickers \u548c classes \u6570\u7ec4");}}
async function copyText(text){let ok=false;try{await navigator.clipboard.writeText(text);ok=true;}catch(e){const ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.left="-9999px";document.body.appendChild(ta);ta.select();try{ok=document.execCommand("copy");}catch(err){}document.body.removeChild(ta);}showToast(ok?"\u5df2\u590d\u5236":"\u590d\u5236\u88ab\u62e6\u622a");}
function showToast(msg){const toast=byId("toast");toast.textContent=msg;toast.classList.add("show");setTimeout(()=>toast.classList.remove("show"),1200);}
let librarySearch = "", manageStickerSearch = "", monthSelectedDate = dateKey(new Date());

function courseTone(x){const t=(x.courseType+" "+x.className).toLowerCase();if(t.includes("中文")||t.includes("chinese"))return "leaf";if(t.includes("写作")||t.includes("writing")||t.includes("创意"))return "coral";if(t.includes("议论")||t.includes("essay"))return "sky";return "ocean";}
function statusTone(x){const text=countdownText(x);if(text.includes("上课中"))return "now";if(text.includes("还有"))return "soon";if(text.includes("已"))return "past";return "plain";}
function filterStickersWithSearch(list,scene,audience,keyword){const q=(keyword||"").trim().toLowerCase();return filterStickers(list,scene,audience).filter(x=>!q||[x.title,x.content,SCENE_LABELS[x.scene],AUDIENCE_LABELS[x.audience],x.note,x.tags].join(" ").toLowerCase().includes(q));}
function fieldCard(label,value,wide=false){return `<div class="detail-line ${wide?'wide':''}"><span>${esc(label)}</span><b>${esc(value||"未填")}</b></div>`;}

function renderToday(){const classes=displayClasses();const labels={today:["今日","今天课程和最近要做的事"],week:["本周","周一到周日，一眼看完课程安排"],month:["月总览",monthTitle()+" · 点日期看当天课程"]};setHead(labels[scheduleMode][0],labels[scheduleMode][1],classes.length+" classes");byId("tabs").innerHTML=`<div class="schedule-switch">${tabs([{value:"today",label:"今日"},{value:"week",label:"本周"},{value:"month",label:"月总览"}],scheduleMode,"scheduleMode")}</div>`;if(scheduleMode==="today")byId("content").innerHTML=renderTodayDesk(classes);if(scheduleMode==="week")byId("content").innerHTML=renderWeekCards(classes);if(scheduleMode==="month")byId("content").innerHTML=renderMonthCalendar(classes);bindTodayEvents();bindScheduleCards(classes);}
function renderTodayDesk(classes){const now=new Date(),today=classesOnDate(classes,now);const next=(today.length?today:classes.slice().sort((a,b)=>{const da=(WORKDAYS.indexOf(a.weekday)-WORKDAYS.indexOf(todayName(0))+7)%7,db=(WORKDAYS.indexOf(b.weekday)-WORKDAYS.indexOf(todayName(0))+7)%7;return da-db||timeMinutes(a.time)-timeMinutes(b.time);}))[0];const upcoming=classes.slice().sort((a,b)=>{const da=(WORKDAYS.indexOf(a.weekday)-WORKDAYS.indexOf(todayName(0))+7)%7,db=(WORKDAYS.indexOf(b.weekday)-WORKDAYS.indexOf(todayName(0))+7)%7;return da-db||timeMinutes(a.time)-timeMinutes(b.time);}).slice(0,6);return `<div class="earth-today"><section class="earth-hero"><div class="calendar-orb"><span>${monthTitle(now)}</span><b>${now.getDate()}</b><em>${todayName(0)}</em></div><div><h3>${next?esc(formatTimeCN(next.time)+" · "+next.className):"今天没有课"}</h3><p>${next?`${esc(next.teacher||"未填老师")} · ${esc(zoomName(next)||"未填 Zoom")} · ${esc(lessonLabel(next))}`:"可以去话术页整理常用话术。"}</p>${next?`<button class="btn primary" data-schedule-id="${safeAttr(next.id)}" data-occurrence-date="${safeAttr(next._occurrenceDate||dateKey(now))}">查看课程</button>`:""}</div></section><section class="earth-panel"><div class="panel-head"><h3>今天课程</h3><span>${today.length} 节</span></div><div class="today-strip">${today.map(x=>renderScheduleCard(x,false)).join("")||'<p class="empty">今天没有课。</p>'}</div></section><section class="earth-panel"><div class="panel-head"><h3>最近课程</h3><span>快速查看</span></div><div class="today-strip">${upcoming.map(x=>renderScheduleCard(x,false)).join("")}</div></section></div>`;}
function renderWeekLesson(x){
  const zoom=zoomName(x);
  return `<button class="week-lesson ${courseTone(x)} ${statusTone(x)}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button">
    <span class="week-lesson-time">${esc(formatTimeCN(x.time))}</span>
    <span class="week-lesson-main"><b>${esc(x.className)}</b><small>${esc(x.teacher||"未填老师")} · ${x.students.length||0} 人</small></span>
    <span class="week-lesson-meta">${zoom?esc(zoom):"未填 Zoom"} · ${esc(lessonLabel(x))}</span>
    <em>${esc(countdownText(x))}</em>
  </button>`;
}
function renderWeekCards(classes){const start=weekStart();return `<div class="week-card-grid earth-week">${WORKDAYS.map((day,i)=>{const d=addDays(start,i),items=classesOnDate(classes,d);return `<section class="week-day-card ${day===todayName(0)?'today':''}"><div class="day-card-head"><div><b>${esc(day)}</b><small>${dateLabel(d)}</small></div><span>${items.length} 节</span></div><div class="day-card-list">${items.map(renderWeekLesson).join("")||'<p class="empty mini">没课</p>'}</div></section>`;}).join("")}</div>`;}
function renderMonthCalendar(classes){const now=new Date(),first=new Date(now.getFullYear(),now.getMonth(),1),last=new Date(now.getFullYear(),now.getMonth()+1,0),offset=(first.getDay()+6)%7,start=addDays(first,-offset),cellCount=Math.ceil((offset+last.getDate())/7)*7,cells=Array.from({length:cellCount},(_,i)=>addDays(start,i));const selected=parseLocalDate(monthSelectedDate)||now;const selectedItems=classesOnDate(classes,selected);return `<div class="month-overview"><section class="month-map"><div class="month-weekdays">${WORKDAYS.map(d=>`<b>${esc(d.replace("周",""))}</b>`).join("")}</div><div class="month-dots-grid">${cells.map(d=>{const muted=d.getMonth()!==now.getMonth(),items=muted?[]:classesOnDate(classes,d),today=d.toDateString()===now.toDateString(),selectedDay=dateKey(d)===monthSelectedDate;return `<button class="month-dot-cell ${muted?'muted':''} ${today?'today':''} ${selectedDay?'selected':''}" data-month-day="${safeAttr(dateKey(d))}" type="button"><b>${d.getDate()}</b><span>${items.length?items.length+"节":""}</span><i>${items.map(x=>`<em class="${courseTone(x)}"></em>`).join("")}</i></button>`;}).join("")}</div></section><section class="month-detail"><div class="panel-head"><h3>${dateLabel(selected)} 课程</h3><span>${selectedItems.length} 节</span></div><div class="month-detail-list">${selectedItems.map(x=>renderScheduleCard(x,false)).join("")||'<p class="empty">这天没有课。</p>'}</div></section></div>`;}
function renderMonthCourse(x){return renderScheduleCard(x,false);}
function renderScheduleCard(x,active){const zoom=zoomName(x),tone=courseTone(x),status=statusTone(x);return `<button class="schedule-card ${tone} ${status} ${active?'active':''}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button"><div class="course-card-top"><span class="mini-time">${esc(formatTimeCN(x.time))}</span><span class="countdown-pill">${esc(countdownText(x))}</span></div><b>${esc(x.className)}</b><small>${esc(x.teacher||"未填老师")} · ${x.students.length||0} 人</small><em>${zoom?esc(zoom):"未填 Zoom"} · ${esc(lessonLabel(x))}</em></button>`;}
function classDetailHtml(item){const zoomLink=item.zoomLink?`<a href="${safeAttr(item.zoomLink)}" target="_blank" rel="noreferrer">${esc(item.zoomLink)}</a>`:"未填";return `<div class="detail-section"><h4>上课信息</h4><div class="detail-grid">${fieldCard("老师",item.teacher)}${fieldCard("学生",item.students.map(s=>s.name).join("、")||"暂无")}${fieldCard("课程",item.courseType)}${fieldCard("进度",lessonLabel(item))}${fieldCard("主题",item.topic)}${fieldCard("状态",STATUS_LABELS[item.status])}</div></div><div class="detail-section"><h4>Zoom</h4><div class="detail-grid">${fieldCard("账号",zoomName(item))}<div class="detail-line"><span>链接</span><b>${zoomLink}</b></div>${fieldCard("会议号",item.zoomId)}${fieldCard("密码",item.zoomPassword)}</div></div><div class="detail-section">${fieldCard("上周作业",item.homework,true)}${fieldCard("课堂记录",item.report||(item.notes[0]&&item.notes[0].text),true)}</div>`;}
function openClassDetailModal(item){const isDemo=String(item.id||"").startsWith("demo-");byId("detailTags").innerHTML=`<span class="scene-tag">${esc(item.weekday)}</span><span class="audience-tag">${STATUS_LABELS[item.status]}</span><span class="audience-tag">${esc(countdownText(item))}</span>`;byId("detailTitle").textContent=(item.time?formatTimeCN(item.time)+" · ":"")+item.className;byId("detailContent").innerHTML=classDetailHtml(item);byId("detailOpenZoom").hidden=!item.zoomLink;byId("detailOpenZoom").onclick=()=>{if(item.zoomLink)window.open(item.zoomLink,"_blank");};byId("detailEdit").hidden=isDemo;byId("detailEdit").textContent="编辑";byId("detailEdit").onclick=isDemo?null:()=>renderClassInlineEditor(item);byId("detailCopy").textContent="复制课程详情";byId("detailCopy").onclick=()=>copyText(classDetailText(item));byId("detailModal").classList.add("show");byId("detailModal").setAttribute("aria-hidden","false");}
function renderClassInlineEditor(item){byId("detailTags").innerHTML=`<span class="scene-tag">${esc(item.weekday)}</span><span class="audience-tag">直接编辑</span>`;byId("detailTitle").textContent="编辑 · "+item.className;byId("detailContent").innerHTML=`<div class="modal-edit-card"><div class="form-grid"><label class="field">星期<select id="modalWeekday">${WORKDAYS.map(v=>`<option value="${v}" ${item.weekday===v?'selected':''}>${v}</option>`).join("")}</select></label><label class="field">时间<input id="modalTime" type="time" value="${safeAttr(item.time)}"></label><label class="field">课程名<input id="modalName" value="${safeAttr(item.className)}"></label><label class="field">老师<input id="modalTeacher" value="${safeAttr(item.teacher)}"></label><label class="field">课程类型<input id="modalType" value="${safeAttr(item.courseType)}"></label><label class="field">状态<select id="modalStatus">${["Active","Paused","Archived"].map(v=>`<option value="${v}" ${item.status===v?'selected':''}>${STATUS_LABELS[v]}</option>`).join("")}</select></label><label class="field">开课日期<input id="modalStartDate" type="date" value="${safeAttr(item.startDate)}"></label><label class="field">总课数<input id="modalTotalLessons" value="${safeAttr(item.totalLessons)}"></label><label class="field">本周主题<input id="modalTopic" value="${safeAttr(item.topic)}"></label><label class="field">Zoom 账号<input id="modalZoomLabel" value="${safeAttr(item.zoomLabel)}"></label><label class="field">Zoom 链接<input id="modalZoomLink" value="${safeAttr(item.zoomLink)}"></label><label class="field">Zoom ID<input id="modalZoomId" value="${safeAttr(item.zoomId)}"></label><label class="field">Zoom 密码<input id="modalZoomPassword" value="${safeAttr(item.zoomPassword)}"></label><label class="field full">学生<textarea id="modalStudents">${esc((item.students||[]).map(s=>s.name+(s.note?' | '+s.note:'')).join('\n'))}</textarea></label><label class="field full">上周作业<textarea id="modalHomework">${esc(item.homework||"")}</textarea></label><label class="field full">课堂记录<textarea id="modalReport">${esc(item.report||(item.notes[0]&&item.notes[0].text)||"")}</textarea></label></div></div>`;byId("detailOpenZoom").hidden=true;byId("detailEdit").hidden=false;byId("detailEdit").textContent="取消";byId("detailEdit").onclick=()=>openClassDetailModal(item);byId("detailCopy").textContent="保存课程";byId("detailCopy").onclick=()=>saveInlineClass(item.id);}
function saveInlineClass(id){const existing=scheduleData.find(x=>x.id===id);if(!existing)return;const report=byId("modalReport").value.trim();const item=normalizeClassItem({...existing,weekday:byId("modalWeekday").value,time:byId("modalTime").value,className:byId("modalName").value||"未命名课程",teacher:byId("modalTeacher").value,courseType:byId("modalType").value,status:byId("modalStatus").value,startDate:byId("modalStartDate").value,totalLessons:byId("modalTotalLessons").value,topic:byId("modalTopic").value,zoomLabel:byId("modalZoomLabel").value,zoomLink:byId("modalZoomLink").value,zoomId:byId("modalZoomId").value,zoomPassword:byId("modalZoomPassword").value,students:parseStudents(byId("modalStudents").value),homework:byId("modalHomework").value,report});if(report){if(item.notes[0]){item.notes[0].text=report;item.notes[0].updatedAt=new Date().toISOString();}else item.notes.unshift({id:uid("note"),text:report,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});}const idx=scheduleData.findIndex(x=>x.id===id);scheduleData[idx]={...scheduleData[idx],...item};saveSchedule();showToast("已保存课程");render();openClassDetailModal(scheduleData[idx]);}

function renderStickers(){const list=filterStickersWithSearch(stickerPool(),libraryScene,libraryAudience,librarySearch);setHead("话术","搜索、筛选、点卡片看全文，按钮复制",list.length+" stickers");byId("tabs").innerHTML="";byId("content").innerHTML=`<div class="library-shell"><div class="library-toolbar"><input class="search-input" id="librarySearch" value="${safeAttr(librarySearch)}" placeholder="搜索标题或内容，比如 Zoom、作业、迟到"><div class="size-switch">${tabs([{value:"compact",label:"小卡"},{value:"normal",label:"大卡"}],cardSize,"cardSize")}</div></div><div class="filter-panel">${filterBar("library",libraryScene,libraryAudience)}</div><div class="library-grid ${cardSize==="compact"?'compact':''}">${list.map(renderStickerCard).join("")||'<p class="empty">没有匹配的话术。</p>'}</div></div>`;bindLibraryEvents();bindCopy(list);bindDetail(list);}
function renderStickerCard(x){return `<article class="sticker-card ${x.scene}"><button class="sticker-open" data-detail-id="${safeAttr(x.id)}" type="button"><div class="tag-row"><span class="scene-tag">${SCENE_LABELS[x.scene]}</span><span class="audience-tag">${AUDIENCE_LABELS[x.audience]}</span></div><b>${esc(x.title)}</b><p>${esc(x.content)}</p></button><button class="copy-badge" data-copy-id="${safeAttr(x.id)}" type="button">复制</button></article>`;}
function openStickerDetail(item){byId("detailTags").innerHTML=`<span class="scene-tag">${SCENE_LABELS[item.scene]}</span><span class="audience-tag">${AUDIENCE_LABELS[item.audience]}</span>`;byId("detailTitle").textContent=item.title;byId("detailContent").innerHTML=`<div class="sticker-fulltext">${esc(item.content)}</div>`;byId("detailOpenZoom").hidden=true;byId("detailEdit").hidden=true;byId("detailCopy").textContent="复制这条话术";byId("detailCopy").onclick=()=>copyText(item.content);byId("detailModal").classList.add("show");byId("detailModal").setAttribute("aria-hidden","false");}
function bindTodayEvents(){document.querySelectorAll("[data-scheduleMode]").forEach(b=>b.addEventListener("click",()=>{scheduleMode=b.dataset.schedulemode;render();}));document.querySelectorAll("[data-month-day]").forEach(b=>b.addEventListener("click",()=>{monthSelectedDate=b.dataset.monthDay;render();}));}
function bindLibraryEvents(){document.querySelectorAll("[data-libraryScene]").forEach(b=>b.addEventListener("click",()=>{libraryScene=b.dataset.libraryscene;render();}));document.querySelectorAll("[data-libraryAudience]").forEach(b=>b.addEventListener("click",()=>{libraryAudience=b.dataset.libraryaudience;render();}));document.querySelectorAll("[data-cardSize]").forEach(b=>b.addEventListener("click",()=>{cardSize=b.dataset.cardsize;render();}));const search=byId("librarySearch");if(search)search.addEventListener("input",()=>{librarySearch=search.value;render();});}

function renderManageHome(){byId("content").innerHTML=`<div class="manage-home compact earth-manage-home"><button class="manage-card" data-manage-go="classes"><b>课程</b><p>时间、Zoom、自动进度、作业记录。</p></button><button class="manage-card" data-manage-go="stickers"><b>话术</b><p>搜索后点卡片，直接修改常用话术。</p></button><button class="manage-card" data-manage-go="trash"><b>回收站</b><p>恢复误删课程或话术。</p></button><button class="manage-card" data-manage-go="backup"><b>备份</b><p>导出或导入全部资料。</p></button></div>`;}
function renderStickerManage(){const list=filterStickersWithSearch(stickersData.filter(x=>!x.deletedAt),manageStickerScene,manageStickerAudience,manageStickerSearch);const current=stickersData.find(x=>x.id===editingStickerId)||null;byId("content").innerHTML=`<div class="manage-layout sticker-manage"><section class="list-panel"><div class="panel-head"><h3>找话术</h3><button class="btn primary" data-new-sticker>新增</button></div><input class="search-input" id="manageStickerSearch" value="${safeAttr(manageStickerSearch)}" placeholder="搜索要修改的话术"><div class="manage-filter">${filterBar("manageSticker",manageStickerScene,manageStickerAudience)}</div><div class="item-list card-list">${list.map(x=>`<button class="list-item ${x.id===editingStickerId?'active':''}" data-edit-sticker="${safeAttr(x.id)}"><b>${esc(x.title)}</b><span>${SCENE_LABELS[x.scene]} · ${AUDIENCE_LABELS[x.audience]}${x.archivedAt?' · 已归档':''}</span></button>`).join("")||'<p class="empty">这个分类里没有话术。</p>'}</div></section><section class="edit-panel preview-edit">${stickerForm(current)}</section></div>`;}
function stickerForm(x){x=x||{scene:"before",audience:"group",title:"",content:"",note:""};return `<h3>${x.id?'编辑话术':'新增话术'}</h3><div class="sticker-editor-grid"><div class="form-grid"><label class="field">标题<input id="stickerTitle" value="${safeAttr(x.title)}"></label><label class="field">场景<select id="stickerScene">${SCENES.map(v=>`<option value="${v}" ${x.scene===v?'selected':''}>${SCENE_LABELS[v]}</option>`).join("")}</select></label><label class="field">发给<select id="stickerAudience">${AUDIENCES.map(v=>`<option value="${v}" ${x.audience===v?'selected':''}>${AUDIENCE_LABELS[v]}</option>`).join("")}</select></label><label class="field">备注<input id="stickerNote" value="${safeAttr(x.note||"")}"></label><label class="field full">内容<textarea id="stickerContent">${esc(x.content||"")}</textarea></label></div><aside class="live-preview"><span>预览</span><b>${esc(x.title||"新话术标题")}</b><p>${esc(x.content||"这里会显示话术内容，保存后会变成话术卡片。")}</p></aside></div><div class="form-actions"><button class="btn primary" data-save-sticker>保存</button>${x.id?'<button class="btn ghost" data-archive-sticker>归档</button><button class="btn danger" data-delete-sticker>删除</button>':''}</div>`;}
function renderClassManage(){const list=scheduleData.filter(x=>x.status!=="Deleted");const current=scheduleData.find(x=>x.id===editingClassId)||null;byId("content").innerHTML=`<div class="manage-layout class-manage"><section class="list-panel"><div class="panel-head"><h3>课程</h3><button class="btn primary" data-new-class>新增</button></div><div class="item-list card-list">${list.map(x=>`<button class="list-item course-list-item ${x.id===editingClassId?'active':''}" data-edit-class="${safeAttr(x.id)}"><b>${esc(x.weekday)} ${esc(formatTimeCN(x.time))}</b><span>${esc(x.className)} · ${esc(x.teacher||"未填老师")}</span></button>`).join("")}</div></section><section class="edit-panel preview-edit">${classForm(current)}</section></div>`;}
function classForm(x){x=x||{weekday:"周一",time:"",teacher:"",courseType:"",className:"",status:"Active",students:[],notes:[],zoomLink:"",zoomId:"",zoomLabel:"",zoomPassword:"",lesson:"",topic:"",totalLessons:"20",startDate:"",homework:"",report:""};return `<h3>${x.id?'编辑课程':'新增课程'}</h3><p class="form-hint">先填课程卡；开课日期 + 总课数会自动算第几课。</p><div class="form-grid game-form"><div class="form-section full"><b>课程卡</b><div class="form-grid inner"><label class="field">星期<select id="classWeekday">${WORKDAYS.map(v=>`<option value="${v}" ${x.weekday===v?'selected':''}>${v}</option>`).join("")}</select></label><label class="field">时间<input id="classTime" type="time" value="${safeAttr(x.time)}"></label><label class="field">课程名<input id="className" value="${safeAttr(x.className)}" placeholder="如：英文精读 HP3"></label><label class="field">老师<input id="classTeacher" value="${safeAttr(x.teacher)}"></label><label class="field">课程类型<input id="classCourseType" value="${safeAttr(x.courseType)}" placeholder="英文精读 / 中文趣味 / 创意写作"></label><label class="field">状态<select id="classStatus">${["Active","Paused","Archived"].map(v=>`<option value="${v}" ${x.status===v?'selected':''}>${STATUS_LABELS[v]}</option>`).join("")}</select></label></div></div><div class="form-section"><b>自动进度</b><label class="field">开课日期<input id="classStartDate" type="date" value="${safeAttr(x.startDate)}"></label><label class="field">总课数<input id="classTotalLessons" value="${safeAttr(x.totalLessons)}" placeholder="20"></label><label class="field">本周主题<input id="classTopic" value="${safeAttr(x.topic)}" placeholder="如：Harry Potter 3"></label><input id="classLesson" type="hidden" value="${safeAttr(x.lesson)}"></div><div class="form-section"><b>Zoom</b><label class="field">Zoom 账号<input id="classZoomLabel" value="${safeAttr(x.zoomLabel)}" placeholder="zoom1 / zoom2 / camp / siyanci"></label><label class="field">Zoom 链接<input id="classZoomLink" value="${safeAttr(x.zoomLink)}"></label><label class="field">Zoom ID<input id="classZoomId" value="${safeAttr(x.zoomId)}"></label><label class="field">Zoom 密码<input id="classZoomPassword" value="${safeAttr(x.zoomPassword)}"></label></div><label class="field full">学生<textarea id="classStudents" placeholder="每行一个学生；可写：姓名 | 备注">${esc((x.students||[]).map(s=>s.name+(s.note?' | '+s.note:'')).join('\n'))}</textarea></label><label class="field full">上周作业<textarea id="classHomework">${esc(x.homework||"")}</textarea></label><label class="field full">课堂报告 / 自己的备注<textarea id="classReport">${esc(x.report||(x.notes&&x.notes[0]&&x.notes[0].text)||"")}</textarea></label></div><div class="form-actions"><button class="btn primary" data-save-class>保存</button>${x.id?'<button class="btn ghost" data-archive-class>归档</button><button class="btn danger" data-delete-class>删除</button>':''}</div>`;}
function bindManageEvents(){document.querySelectorAll("[data-manage]").forEach(b=>b.addEventListener("click",()=>{manageMode=b.dataset.manage;editingStickerId=null;editingClassId=null;render();}));document.querySelectorAll("[data-manage-go]").forEach(b=>b.addEventListener("click",()=>{manageMode=b.dataset.manageGo;render();}));document.querySelectorAll("[data-manageStickerScene]").forEach(b=>b.addEventListener("click",()=>{manageStickerScene=b.dataset.managestickerscene;editingStickerId=null;render();}));document.querySelectorAll("[data-manageStickerAudience]").forEach(b=>b.addEventListener("click",()=>{manageStickerAudience=b.dataset.managestickeraudience;editingStickerId=null;render();}));const ms=byId("manageStickerSearch");if(ms)ms.addEventListener("input",()=>{manageStickerSearch=ms.value;render();});document.querySelectorAll("[data-edit-sticker]").forEach(b=>b.addEventListener("click",()=>{editingStickerId=b.dataset.editSticker;render();}));document.querySelectorAll("[data-new-sticker]").forEach(b=>b.addEventListener("click",()=>{editingStickerId=null;render();}));document.querySelectorAll("[data-save-sticker]").forEach(b=>b.addEventListener("click",saveStickerFromForm));document.querySelectorAll("[data-archive-sticker]").forEach(b=>b.addEventListener("click",()=>{const x=stickersData.find(s=>s.id===editingStickerId);if(x){x.archivedAt=x.archivedAt?"":new Date().toISOString();saveStickers();render();}}));document.querySelectorAll("[data-delete-sticker]").forEach(b=>b.addEventListener("click",()=>{const x=stickersData.find(s=>s.id===editingStickerId);if(x){x.deletedAt=new Date().toISOString();editingStickerId=null;saveStickers();render();}}));document.querySelectorAll("[data-edit-class]").forEach(b=>b.addEventListener("click",()=>{editingClassId=b.dataset.editClass;render();}));document.querySelectorAll("[data-new-class]").forEach(b=>b.addEventListener("click",()=>{editingClassId=null;render();}));document.querySelectorAll("[data-save-class]").forEach(b=>b.addEventListener("click",saveClassFromForm));document.querySelectorAll("[data-archive-class]").forEach(b=>b.addEventListener("click",()=>{const x=scheduleData.find(c=>c.id===editingClassId);if(x){x.status="Archived";x.archivedAt=new Date().toISOString();saveSchedule();render();}}));document.querySelectorAll("[data-delete-class]").forEach(b=>b.addEventListener("click",()=>{const x=scheduleData.find(c=>c.id===editingClassId);if(x){x.status="Deleted";x.deletedAt=new Date().toISOString();editingClassId=null;saveSchedule();render();}}));document.querySelectorAll("[data-restore-sticker]").forEach(b=>b.addEventListener("click",()=>{const x=stickersData.find(s=>s.id===b.dataset.restoreSticker);if(x){x.deletedAt="";saveStickers();render();}}));document.querySelectorAll("[data-purge-sticker]").forEach(b=>b.addEventListener("click",()=>{if(!confirm("确定彻底删除这条话术吗？"))return;stickersData=stickersData.filter(s=>s.id!==b.dataset.purgeSticker);saveStickers();render();}));document.querySelectorAll("[data-restore-class]").forEach(b=>b.addEventListener("click",()=>{const x=scheduleData.find(c=>c.id===b.dataset.restoreClass);if(x){x.status="Active";x.deletedAt="";saveSchedule();render();}}));document.querySelectorAll("[data-purge-class]").forEach(b=>b.addEventListener("click",()=>{if(!confirm("确定彻底删除这节课吗？"))return;scheduleData=scheduleData.filter(c=>c.id!==b.dataset.purgeClass);saveSchedule();render();}));document.querySelectorAll("[data-export-all]").forEach(b=>b.addEventListener("click",()=>{byId("backupText").value=JSON.stringify({stickers:stickersData,classes:scheduleData,stickerCategories,courseCategories},null,2);showToast("已导出");}));document.querySelectorAll("[data-import-all]").forEach(b=>b.addEventListener("click",importAll));}

function renderScheduleCard(x,active){
  const zoom=zoomName(x),tone=courseTone(x),status=statusTone(x);
  return `<button class="schedule-card ${tone} ${status} ${active?'active':''}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button">
    <div class="note-tape"></div>
    <div class="course-card-top"><span class="mini-time">${esc(formatTimeCN(x.time))}</span><span class="countdown-pill">${esc(countdownText(x))}</span></div>
    <b>${esc(x.className)}</b>
    <div class="schedule-meta"><span>${esc(x.teacher||"未填老师")}</span><span>${x.students.length||0} 人</span></div>
    <div class="schedule-badges"><i>${zoom?esc(zoom):"未填 Zoom"}</i><i>${esc(lessonLabel(x))}</i></div>
  </button>`;
}

function renderStickers(){
  const list=filterStickersWithSearch(stickerPool(),libraryScene,libraryAudience,librarySearch);
  setHead("话术便签墙","搜索、筛选、点便签看全文，右下角复制",list.length+" stickers");
  byId("tabs").innerHTML="";
  byId("content").innerHTML=`<div class="library-shell hand-library">
    <div class="library-toolbar">
      <input class="search-input" id="librarySearch" value="${safeAttr(librarySearch)}" placeholder="搜索：Zoom、作业、迟到、请假、总结">
      <div class="size-switch">${tabs([{value:"compact",label:"密集墙"},{value:"normal",label:"大便签"}],cardSize,"cardSize")}</div>
    </div>
    <div class="filter-panel">${filterBar("library",libraryScene,libraryAudience)}</div>
    <div class="library-grid ${cardSize==="compact"?'compact':''}">${list.map(renderStickerCard).join("")||'<p class="empty">没有匹配的话术。</p>'}</div>
  </div>`;
  bindLibraryEvents();bindCopy(list);bindDetail(list);
}

function renderStickerCard(x){
  const audience=x.scene==="ai"&&x.audience==="ai"?"":`<span class="audience-tag">${AUDIENCE_LABELS[x.audience]}</span>`;
  return `<article class="sticker-card ${x.scene}">
    <div class="note-tape"></div>
    <button class="sticker-open" data-detail-id="${safeAttr(x.id)}" type="button">
      <div class="tag-row"><span class="scene-tag">${SCENE_LABELS[x.scene]}</span>${audience}</div>
      <b>${esc(x.title)}</b>
      <p>${esc(x.content)}</p>
    </button>
    <button class="copy-badge" data-copy-id="${safeAttr(x.id)}" type="button">复制</button>
  </article>`;
}

function filterBar(prefix,scene,audience,auto=false){
  const sceneItems=[...(auto?[{value:"auto",label:"自动"}]:[]),{value:"all",label:"全部"},...SCENES.map(x=>({value:x,label:x==="ai"?"AI提示":SCENE_LABELS[x]}))];
  const audItems=[{value:"all",label:"全部"},...AUDIENCE_FILTERS.map(x=>({value:x,label:AUDIENCE_LABELS[x]}))];
  return `<div class="filter-line compact-filter"><span class="filter-label">场景</span>${tabs(sceneItems,scene,prefix+"Scene")}</div><div class="filter-line compact-filter"><span class="filter-label">对象</span>${tabs(audItems,audience,prefix+"Audience")}</div>`;
}

function renderMonthLesson(x){
  const zoom=zoomName(x);
  return `<button class="month-lesson ${courseTone(x)}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button">
    <span class="month-lesson-time">${esc(formatTimeCN(x.time))}</span>
    <span class="month-lesson-body"><b>${esc(x.className)}</b><small>${esc(x.teacher||"未填老师")} · ${zoom?esc(zoom):"未填 Zoom"} · ${esc(lessonLabel(x))}</small></span>
    <em>${esc(countdownText(x))}</em>
  </button>`;
}

function renderMonthCalendar(classes){
  const now=new Date(),first=new Date(now.getFullYear(),now.getMonth(),1),last=new Date(now.getFullYear(),now.getMonth()+1,0),offset=(first.getDay()+6)%7,start=addDays(first,-offset),cellCount=Math.ceil((offset+last.getDate())/7)*7,cells=Array.from({length:cellCount},(_,i)=>addDays(start,i));
  const selected=parseLocalDate(monthSelectedDate)||now;
  const selectedItems=classesOnDate(classes,selected);
  return `<div class="month-overview">
    <section class="month-map">
      <div class="month-weekdays">${WORKDAYS.map(d=>`<b>${esc(d.replace("周",""))}</b>`).join("")}</div>
      <div class="month-dots-grid">${cells.map(d=>{
        const muted=d.getMonth()!==now.getMonth(),items=muted?[]:classesOnDate(classes,d),today=d.toDateString()===now.toDateString(),selectedDay=dateKey(d)===monthSelectedDate;
        return `<button class="month-dot-cell ${muted?'muted':''} ${today?'today':''} ${selectedDay?'selected':''}" data-month-day="${safeAttr(dateKey(d))}" type="button">
          <b>${muted?'':d.getDate()}</b>
          <span>${items.length?items.length+"节":""}</span>
          <i>${items.map(x=>`<em class="${courseTone(x)}"></em>`).join("")}</i>
        </button>`;
      }).join("")}</div>
    </section>
    <section class="month-detail">
      <div class="panel-head"><h3>${dateLabel(selected)} 课程</h3><span>${selectedItems.length} 节</span></div>
      <div class="month-detail-list">${selectedItems.map(renderMonthLesson).join("")||'<p class="empty">这天没有课。</p>'}</div>
    </section>
  </div>`;
}

function filterBar(prefix,scene,audience,auto=false){
  const sceneItems=[...(auto?[{value:"auto",label:"自动"}]:[]),{value:"all",label:"全部"},...SCENES.map(x=>({value:x,label:x==="ai"?"AI":SCENE_LABELS[x]}))];
  const audItems=[{value:"all",label:"全部"},...AUDIENCE_FILTERS.map(x=>({value:x,label:AUDIENCE_LABELS[x]}))];
  return `<div class="filter-line compact-filter no-label">${tabs(sceneItems,scene,prefix+"Scene")}</div><div class="filter-line compact-filter no-label">${tabs(audItems,audience,prefix+"Audience")}</div>`;
}

let calendarMonthOffset = 0;

function weekRangeLabel(){const start=weekStart(),end=addDays(start,6);return `${dateLabel(start)} - ${dateLabel(end)}`;}
function addMonths(d,n){const x=new Date(d);x.setMonth(x.getMonth()+n);return x;}
function compactStatusList(x){const list=[];if(!zoomName(x))list.push("未填 Zoom");if(!x.startDate&&!x.lesson)list.push("进度未填");const cd=countdownText(x);if(cd&&cd!=="未定时间")list.push(cd);return list.slice(0,2);}

function renderWeekLesson(x){
  const status=compactStatusList(x);
  return `<button class="week-lesson vertical-note ${courseTone(x)}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button">
    <span class="week-lesson-time">${esc(formatTimeCN(x.time))}</span>
    <b>${esc(x.className)}</b>
    <small>${esc(x.teacher||"未填老师")} · ${x.students.length||0} 人 · ${esc(lessonLabel(x))}</small>
    <em>${esc(zoomName(x)||"未填 Zoom")}</em>
    ${status.length?`<i>${status.map(esc).join(" · ")}</i>`:""}
  </button>`;
}

function renderWeekCards(classes){
  const start=weekStart(),work=WORKDAYS.slice(0,5),weekend=WORKDAYS.slice(5);
  return `<div class="week-planner">
    <div class="week-planner-main">${work.map((day,i)=>{const d=addDays(start,i),items=classesOnDate(classes,d);return `<section class="weekday-lane ${day===todayName(0)?'today':''}">
      <div class="lane-head"><div><b>${esc(day)}</b><small>${dateLabel(d)}</small></div><span>${items.length} 节</span></div>
      <div class="lane-scroll">${items.map(renderWeekLesson).join("")||'<p class="no-class">没课</p>'}</div>
    </section>`;}).join("")}</div>
    <aside class="weekend-strip">${weekend.map((day,i)=>{const d=addDays(start,5+i),items=classesOnDate(classes,d);return `<section class="weekend-card"><div><b>${esc(day)}</b><small>${dateLabel(d)}</small></div><span>${items.length?items.length+" 节":"没课"}</span>${items.length?`<button data-schedule-id="${safeAttr(items[0].id)}" data-occurrence-date="${safeAttr(items[0]._occurrenceDate||"")}" type="button">${esc(items[0].className)}</button>`:""}</section>`;}).join("")}</aside>
  </div>`;
}

function renderToday(){
  const classes=displayClasses();
  const labels={today:["今日","今天摘要、待处理和课程"],week:["本周",`${weekRangeLabel()} · 工作日优先，周末收起`],month:["月总览",monthTitle(addMonths(new Date(),calendarMonthOffset))+" · 点日期看当天课程"]};
  setHead(labels[scheduleMode][0],labels[scheduleMode][1],classes.length+" classes");
  byId("tabs").innerHTML=`<div class="schedule-switch">${tabs([{value:"today",label:"今日"},{value:"week",label:"本周"},{value:"month",label:"月总览"}],scheduleMode,"scheduleMode")}</div>`;
  if(scheduleMode==="today")byId("content").innerHTML=renderTodayDesk(classes);
  if(scheduleMode==="week")byId("content").innerHTML=renderWeekCards(classes);
  if(scheduleMode==="month")byId("content").innerHTML=renderMonthCalendar(classes);
  bindTodayEvents();bindScheduleCards(classes);
}

function renderTodayDesk(classes){
  const now=new Date(),today=classesOnDate(classes,now);
  const upcoming=classes.slice().sort((a,b)=>{const da=(WORKDAYS.indexOf(a.weekday)-WORKDAYS.indexOf(todayName(0))+7)%7,db=(WORKDAYS.indexOf(b.weekday)-WORKDAYS.indexOf(todayName(0))+7)%7;return da-db||timeMinutes(a.time)-timeMinutes(b.time);}).slice(0,5);
  const next=today[0]||upcoming[0],todo=[];
  if(next&&!zoomName(next))todo.push("补 Zoom");
  if(next&&(!next.startDate&&!next.lesson))todo.push("补进度");
  if(next&&!next.homework)todo.push("补上周作业");
  return `<div class="today-board">
    <section class="today-summary"><span>${monthTitle(now)} ${now.getDate()} · ${todayName(0)}</span><h3>${today.length?`今天 ${today.length} 节课`:"今天没有课"}</h3><p>${next?`下一节：${formatTimeCN(next.time)} · ${next.className}`:"可以整理话术或备份资料"}</p><div class="todo-tags">${(todo.length?todo:["暂无紧急待办"]).map(x=>`<b>${esc(x)}</b>`).join("")}</div></section>
    <section class="today-panel"><div class="panel-head"><h3>今天课程</h3><span>${today.length} 节</span></div><div class="today-course-list">${today.map(renderScheduleCard).join("")||'<p class="no-class">今日无课</p>'}</div></section>
    <section class="today-panel compact"><div class="panel-head"><h3>最近课程</h3><span>索引</span></div><div class="recent-index">${upcoming.map(x=>`<button data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button"><b>${esc(formatTimeCN(x.time))}</b><span>${esc(x.className)}</span><small>${esc(x.teacher||"未填老师")}</small></button>`).join("")}</div></section>
  </div>`;
}

function renderMonthCalendar(classes){
  const base=addMonths(new Date(),calendarMonthOffset),first=new Date(base.getFullYear(),base.getMonth(),1),last=new Date(base.getFullYear(),base.getMonth()+1,0),offset=(first.getDay()+6)%7,start=addDays(first,-offset),cellCount=Math.ceil((offset+last.getDate())/7)*7,cells=Array.from({length:cellCount},(_,i)=>addDays(start,i));
  const selected=parseLocalDate(monthSelectedDate)||new Date(base.getFullYear(),base.getMonth(),1),selectedItems=classesOnDate(classes,selected);
  return `<div class="month-overview refined-month"><section class="month-map"><div class="month-nav"><button class="btn" data-month-move="-1" type="button">上个月</button><b>${monthTitle(base)}</b><button class="btn" data-month-move="1" type="button">下个月</button></div><div class="month-weekdays">${WORKDAYS.map(d=>`<b>${esc(d.replace("周",""))}</b>`).join("")}</div><div class="month-dots-grid">${cells.map(d=>{const muted=d.getMonth()!==base.getMonth(),items=muted?[]:classesOnDate(classes,d),today=d.toDateString()===new Date().toDateString(),selectedDay=dateKey(d)===dateKey(selected);return `<button class="month-dot-cell ${muted?'muted':''} ${today?'today':''} ${selectedDay?'selected':''}" data-month-day="${safeAttr(dateKey(d))}" type="button"><b>${muted?'':d.getDate()}</b><span>${items.length?items.length+"节":""}</span><i>${items.map(x=>`<em class="${courseTone(x)}"></em>`).join("")}</i></button>`;}).join("")}</div></section><section class="month-detail"><div class="panel-head"><h3>${dateLabel(selected)} 课程</h3><span>${selectedItems.length} 节</span></div><div class="month-detail-list">${selectedItems.map(renderMonthLesson).join("")||'<p class="no-class">这天没有课。</p>'}</div></section></div>`;
}

function renderStickers(){
  const list=filterStickersWithSearch(stickerPool(),libraryScene,libraryAudience,librarySearch);
  setHead("话术","左边筛选，右边复制；卡片只放摘要，全文点开看",list.length+" stickers");
  byId("tabs").innerHTML="";
  byId("content").innerHTML=`<div class="phrase-desk"><aside class="phrase-sidebar"><button class="btn primary" data-new-sticker type="button">新增话术</button><div class="phrase-group"><b>课前课中</b>${tabs([{value:"all",label:"全部"},...SCENES.map(x=>({value:x,label:x==="ai"?"AI":SCENE_LABELS[x]}))],libraryScene,"libraryScene")}</div><div class="phrase-group"><b>发给谁</b>${tabs([{value:"all",label:"全部"},...AUDIENCE_FILTERS.map(x=>({value:x,label:AUDIENCE_LABELS[x]}))],libraryAudience,"libraryAudience")}</div></aside><section class="phrase-wall"><div class="phrase-toolbar"><input class="search-input" id="librarySearch" value="${safeAttr(librarySearch)}" placeholder="搜索：Zoom、作业、迟到、请假、总结"><div class="size-switch">${tabs([{value:"compact",label:"密集"},{value:"normal",label:"舒展"}],cardSize,"cardSize")}</div></div><div class="library-grid ${cardSize==="compact"?'compact':''}" id="phraseGrid">${list.map(renderStickerCard).join("")||'<p class="empty">没有匹配的话术。</p>'}</div></section></div>`;
  bindLibraryEvents();bindCopy(list);bindDetail(list);
}

function refreshPhraseGrid(){
  const list=filterStickersWithSearch(stickerPool(),libraryScene,libraryAudience,librarySearch),grid=byId("phraseGrid");
  if(grid){grid.innerHTML=list.map(renderStickerCard).join("")||'<p class="empty">没有匹配的话术。</p>';bindCopy(list);bindDetail(list);}
  byId("counter").textContent=list.length+" stickers";
}

function bindLibraryEvents(){
  document.querySelectorAll("[data-libraryScene]").forEach(b=>b.addEventListener("click",()=>{libraryScene=b.dataset.libraryscene;render();}));
  document.querySelectorAll("[data-libraryAudience]").forEach(b=>b.addEventListener("click",()=>{libraryAudience=b.dataset.libraryaudience;render();}));
  document.querySelectorAll("[data-cardSize]").forEach(b=>b.addEventListener("click",()=>{cardSize=b.dataset.cardsize;render();}));
  document.querySelectorAll("[data-new-sticker]").forEach(b=>b.addEventListener("click",()=>{view="manage";manageMode="stickers";editingStickerId=null;render();}));
  const search=byId("librarySearch");if(search)search.addEventListener("input",()=>{librarySearch=search.value;refreshPhraseGrid();});
}

function bindTodayEvents(){
  document.querySelectorAll("[data-scheduleMode]").forEach(b=>b.addEventListener("click",()=>{scheduleMode=b.dataset.schedulemode;render();}));
  document.querySelectorAll("[data-month-day]").forEach(b=>b.addEventListener("click",()=>{monthSelectedDate=b.dataset.monthDay;render();}));
  document.querySelectorAll("[data-month-move]").forEach(b=>b.addEventListener("click",()=>{calendarMonthOffset+=Number(b.dataset.monthMove)||0;const base=addMonths(new Date(),calendarMonthOffset);monthSelectedDate=dateKey(new Date(base.getFullYear(),base.getMonth(),1));render();}));
}

/* Final clean UI pass: earth notebook, readable schedule, compact phrase wall */
function cleanStatusList(x){
  const list=[];
  if(!zoomName(x)) list.push("缺 Zoom");
  if(!x.startDate&&!x.lesson) list.push("缺进度");
  const cd=countdownText(x);
  if(cd&&cd!=="未定时间") list.push(cd);
  return list.slice(0,2);
}

function renderScheduleCard(x,active){
  const zoom=zoomName(x),status=cleanStatusList(x),teacher=x.teacher||"未填老师";
  return `<button class="schedule-card ${courseTone(x)} ${statusTone(x)} ${active?'active':''}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button">
    <div class="note-tape"></div>
    <div class="course-card-top"><span class="mini-time">${esc(formatTimeCN(x.time))}</span>${status[0]?`<span class="countdown-pill">${esc(status[0])}</span>`:""}</div>
    <b>${esc(x.className)}</b>
    <div class="schedule-meta"><span>${esc(teacher)}</span><span>${x.students.length||0} 人</span></div>
    <div class="schedule-badges"><i>${zoom?esc(zoom):"未填 Zoom"}</i><i>${esc(lessonLabel(x))}</i></div>
  </button>`;
}

function renderWeekLesson(x){
  const status=cleanStatusList(x),zoom=zoomName(x);
  return `<button class="week-lesson vertical-note ${courseTone(x)}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button">
    <div class="note-tape"></div>
    <span class="week-lesson-time">${esc(formatTimeCN(x.time))}</span>
    <b>${esc(x.className)}</b>
    <small>${esc(x.teacher||"未填老师")} · ${x.students.length||0} 人 · ${esc(lessonLabel(x))}</small>
    <em>${zoom?esc(zoom):"未填 Zoom"}</em>
    ${status.length?`<i>${status.map(esc).join(" · ")}</i>`:""}
  </button>`;
}

function renderWeekCards(classes){
  const start=weekStart();
  return `<div class="week-planner week-vertical">
    <div class="week-planner-main">${WORKDAYS.map((day,i)=>{
      const d=addDays(start,i),items=classesOnDate(classes,d);
      return `<section class="weekday-lane ${day===todayName(0)?'today':''} ${i>4?'weekend-lane':''}">
        <div class="lane-head"><div><b>${esc(day)}</b><small>${dateLabel(d)}</small></div><span>${items.length} 节</span></div>
        <div class="lane-scroll">${items.map(renderWeekLesson).join("")||'<p class="no-class">没课</p>'}</div>
      </section>`;
    }).join("")}</div>
  </div>`;
}

function renderToday(){
  const classes=displayClasses();
  const labels={
    today:["今日","今天课程和最近要做的事"],
    week:["本周",`${weekRangeLabel()} · 竖向课表，一眼看每一天`],
    month:["月总览",`${monthTitle(addMonths(new Date(),calendarMonthOffset))} · 点日期看当天课程`]
  };
  setHead(labels[scheduleMode][0],labels[scheduleMode][1],classes.length+" classes");
  byId("tabs").innerHTML=`<div class="schedule-switch">${tabs([{value:"today",label:"今日"},{value:"week",label:"本周"},{value:"month",label:"月总览"}],scheduleMode,"scheduleMode")}</div>`;
  if(scheduleMode==="today") byId("content").innerHTML=renderTodayDesk(classes);
  if(scheduleMode==="week") byId("content").innerHTML=renderWeekCards(classes);
  if(scheduleMode==="month") byId("content").innerHTML=renderMonthCalendar(classes);
  bindTodayEvents();bindScheduleCards(classes);
}

function renderTodayDesk(classes){
  const now=new Date(),today=classesOnDate(classes,now);
  const upcoming=classes.slice().sort((a,b)=>{
    const da=(WORKDAYS.indexOf(a.weekday)-WORKDAYS.indexOf(todayName(0))+7)%7;
    const db=(WORKDAYS.indexOf(b.weekday)-WORKDAYS.indexOf(todayName(0))+7)%7;
    return da-db||timeMinutes(a.time)-timeMinutes(b.time);
  }).slice(0,6);
  const next=today[0]||upcoming[0],todo=[];
  if(next&&!zoomName(next)) todo.push("补 Zoom");
  if(next&&(!next.startDate&&!next.lesson)) todo.push("补进度");
  if(next&&!next.homework) todo.push("补上周作业");
  return `<div class="today-board clean-today">
    <section class="today-summary"><span>${monthTitle(now)} ${now.getDate()} · ${todayName(0)}</span><h3>${next?`${formatTimeCN(next.time)} · ${next.className}`:"今天没有课"}</h3><p>${next?`${next.teacher||"未填老师"} · ${zoomName(next)||"未填 Zoom"} · ${lessonLabel(next)}`:"可以整理话术、备份资料，或者补课程信息。"}</p><div class="todo-tags">${(todo.length?todo:["暂无紧急待办"]).map(x=>`<b>${esc(x)}</b>`).join("")}</div></section>
    <section class="today-panel"><div class="panel-head"><h3>今天课程</h3><span>${today.length} 节</span></div><div class="today-course-list">${today.map(renderScheduleCard).join("")||'<p class="no-class">今日无课</p>'}</div></section>
    <section class="today-panel compact"><div class="panel-head"><h3>最近课程</h3><span>索引</span></div><div class="recent-index">${upcoming.map(x=>`<button data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button"><b>${esc(formatTimeCN(x.time))}</b><span>${esc(x.className)}</span><small>${esc(x.teacher||"未填老师")} · ${esc(lessonLabel(x))}</small></button>`).join("")}</div></section>
  </div>`;
}

function renderMonthLesson(x){
  return `<button class="month-lesson ${courseTone(x)}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button">
    <span class="month-lesson-time">${esc(formatTimeCN(x.time))}</span>
    <span class="month-lesson-body"><b>${esc(x.className)}</b><small>${esc(x.teacher||"未填老师")} · ${esc(zoomName(x)||"未填 Zoom")} · ${esc(lessonLabel(x))}</small></span>
    <em>${esc(countdownText(x))}</em>
  </button>`;
}

function renderMonthCalendar(classes){
  const base=addMonths(new Date(),calendarMonthOffset),first=new Date(base.getFullYear(),base.getMonth(),1),last=new Date(base.getFullYear(),base.getMonth()+1,0);
  const offset=(first.getDay()+6)%7,start=addDays(first,-offset),cellCount=Math.ceil((offset+last.getDate())/7)*7,cells=Array.from({length:cellCount},(_,i)=>addDays(start,i));
  const selected=parseLocalDate(monthSelectedDate)||new Date(base.getFullYear(),base.getMonth(),Math.min(new Date().getDate(),last.getDate()));
  const selectedItems=classesOnDate(classes,selected);
  return `<div class="month-overview refined-month"><section class="month-map"><div class="month-nav"><button class="btn" data-month-move="-1" type="button">上个月</button><b>${monthTitle(base)}</b><button class="btn" data-month-move="1" type="button">下个月</button></div><div class="month-weekdays">${WORKDAYS.map(d=>`<b>${esc(d.replace("周",""))}</b>`).join("")}</div><div class="month-dots-grid">${cells.map(d=>{
    const muted=d.getMonth()!==base.getMonth(),items=muted?[]:classesOnDate(classes,d),today=d.toDateString()===new Date().toDateString(),selectedDay=dateKey(d)===dateKey(selected);
    return `<button class="month-dot-cell ${muted?'muted':''} ${today?'today':''} ${selectedDay?'selected':''}" data-month-day="${safeAttr(dateKey(d))}" type="button"><b>${muted?'':d.getDate()}</b><span>${items.length?items.length+"节":""}</span><i>${items.map(x=>`<em class="${courseTone(x)}"></em>`).join("")}</i></button>`;
  }).join("")}</div></section><section class="month-detail"><div class="panel-head"><h3>${dateLabel(selected)} 课程</h3><span>${selectedItems.length} 节</span></div><div class="month-detail-list">${selectedItems.map(renderMonthLesson).join("")||'<p class="no-class">这天没有课</p>'}</div></section></div>`;
}

function renderStickers(){
  const list=filterStickersWithSearch(stickerPool(),libraryScene,libraryAudience,librarySearch);
  setHead("话术便签墙","",list.length+" stickers");
  byId("tabs").innerHTML="";
  byId("content").innerHTML=`<div class="phrase-desk clean-phrase"><aside class="phrase-sidebar"><div class="phrase-side-head"><b>找话术</b><button class="btn primary" data-new-sticker type="button">新增</button></div><input class="search-input" id="librarySearch" value="${safeAttr(librarySearch)}" placeholder="搜索 Zoom、作业、迟到、总结"><div class="phrase-group"><b>阶段</b>${tabs([{value:"all",label:"全部"},...SCENES.map(x=>({value:x,label:x==="ai"?"AI提示":SCENE_LABELS[x]}))],libraryScene,"libraryScene")}</div><div class="phrase-group"><b>发给</b>${tabs([{value:"all",label:"全部"},...AUDIENCE_FILTERS.map(x=>({value:x,label:AUDIENCE_LABELS[x]}))],libraryAudience,"libraryAudience")}</div></aside><section class="phrase-wall"><div class="phrase-toolbar"><span>${list.length} 条可用便签</span></div><div class="library-grid compact" id="phraseGrid">${list.map(renderStickerCard).join("")||'<p class="empty">没有匹配的话术。</p>'}</div></section></div>`;
  bindLibraryEvents();bindCopy(list);bindDetail(list);
}

function renderStickerCard(x){
  const audience=x.scene==="ai"&&x.audience==="ai"?"":`<span class="audience-tag">${AUDIENCE_LABELS[x.audience]}</span>`;
  return `<article class="sticker-card ${x.scene}">
    <div class="note-tape"></div>
    <button class="sticker-open" data-detail-id="${safeAttr(x.id)}" type="button">
      <div class="tag-row"><span class="scene-tag">${SCENE_LABELS[x.scene]}</span>${audience}</div>
      <b>${esc(x.title)}</b>
      <p>${esc(x.content)}</p>
    </button>
    <button class="copy-badge" data-copy-id="${safeAttr(x.id)}" type="button">复制</button>
  </article>`;
}

function refreshPhraseGrid(){
  const list=filterStickersWithSearch(stickerPool(),libraryScene,libraryAudience,librarySearch),grid=byId("phraseGrid");
  if(grid){grid.innerHTML=list.map(renderStickerCard).join("")||'<p class="empty">没有匹配的话术。</p>';bindCopy(list);bindDetail(list);}
  byId("counter").textContent=list.length+" stickers";
  const toolbar=document.querySelector(".phrase-toolbar span"); if(toolbar) toolbar.textContent=list.length+" 条可用便签";
}

function openStickerDetail(item){
  byId("detailTags").innerHTML=`<span class="scene-tag">${SCENE_LABELS[item.scene]}</span>${item.audience==="ai"&&item.scene==="ai"?"":`<span class="audience-tag">${AUDIENCE_LABELS[item.audience]}</span>`}`;
  byId("detailTitle").textContent=item.title;
  byId("detailContent").innerHTML=`<div class="sticker-fulltext">${esc(item.content)}</div>`;
  byId("detailOpenZoom").hidden=true;
  byId("detailEdit").hidden=false;
  byId("detailEdit").textContent="编辑";
  byId("detailEdit").onclick=()=>{view="manage";manageMode="stickers";editingStickerId=item.id;render();closeStickerDetail();};
  byId("detailCopy").textContent="复制这条话术";
  byId("detailCopy").onclick=()=>copyText(item.content);
  byId("detailModal").classList.add("show");
  byId("detailModal").setAttribute("aria-hidden","false");
}

function syncLibraryFilterButtons(){
  document.querySelectorAll("[data-libraryScene]").forEach(b=>{
    b.classList.toggle("active",b.dataset.libraryscene===libraryScene);
  });
  document.querySelectorAll("[data-libraryAudience]").forEach(b=>{
    b.classList.toggle("active",b.dataset.libraryaudience===libraryAudience);
  });
}

function bindLibraryEvents(){
  syncLibraryFilterButtons();
  document.querySelectorAll("[data-libraryScene]").forEach(b=>b.addEventListener("click",()=>{
    libraryScene=b.dataset.libraryscene;
    syncLibraryFilterButtons();
    refreshPhraseGrid();
  }));
  document.querySelectorAll("[data-libraryAudience]").forEach(b=>b.addEventListener("click",()=>{
    libraryAudience=b.dataset.libraryaudience;
    syncLibraryFilterButtons();
    refreshPhraseGrid();
  }));
  document.querySelectorAll("[data-cardSize]").forEach(b=>b.addEventListener("click",()=>{cardSize=b.dataset.cardsize;render();}));
  document.querySelectorAll("[data-new-sticker]").forEach(b=>b.addEventListener("click",()=>{view="manage";manageMode="stickers";editingStickerId=null;render();}));
  const search=byId("librarySearch");if(search)search.addEventListener("input",()=>{librarySearch=search.value;refreshPhraseGrid();});
}

function renderManageHome(){
  byId("content").innerHTML=`<div class="manage-home compact earth-manage-home clean-manage-home"><button class="manage-card" data-manage-go="stickers"><b>整理话术</b><p>按分类搜索、修改、归档常用话术。</p></button><button class="manage-card" data-manage-go="classes"><b>整理课程</b><p>补开课日、Zoom、老师和学生。</p></button><button class="manage-card" data-manage-go="trash"><b>回收站</b><p>恢复误删内容。</p></button><button class="manage-card" data-manage-go="backup"><b>备份资料</b><p>导出或导入全部数据。</p></button></div>`;
}

/* Final week navigation: previous / current / next week */
var finalWeekOffset = 0;
function activeWeekStart(){return weekStart(addDays(new Date(),finalWeekOffset*7));}
function activeWeekLabel(){const start=activeWeekStart(),end=addDays(start,6);return `${dateLabel(start)} - ${dateLabel(end)}`;}
function renderScheduleControls(){
  const viewTabs=tabs([{value:"today",label:"今日"},{value:"week",label:"本周"},{value:"month",label:"月总览"}],scheduleMode,"scheduleMode");
  const weekNav=scheduleMode==="week"?`<div class="week-jump"><button class="tab" data-week-move="-1" type="button">上一周</button><span>${activeWeekLabel()}</span><button class="tab ${finalWeekOffset===0?'active':''}" data-week-reset type="button">本周</button><button class="tab" data-week-move="1" type="button">下一周</button></div>`:"";
  return `<div class="schedule-controls"><div class="schedule-switch">${viewTabs}</div>${weekNav}</div>`;
}
function renderWeekCards(classes){
  const start=activeWeekStart();
  return `<div class="week-planner week-vertical">
    <div class="week-planner-main">${WORKDAYS.map((day,i)=>{
      const d=addDays(start,i),items=classesOnDate(classes,d);
      return `<section class="weekday-lane ${dateKey(d)===dateKey(new Date())?'today':''} ${i>4?'weekend-lane':''}">
        <div class="lane-head"><div><b>${esc(day)}</b><small>${dateLabel(d)}</small></div><span>${items.length} 节</span></div>
        <div class="lane-scroll">${items.map(renderWeekLesson).join("")||'<p class="no-class">没课</p>'}</div>
      </section>`;
    }).join("")}</div>
  </div>`;
}
function renderToday(){
  const classes=displayClasses();
  const labels={
    today:["今日","今天课程和最近要做的事"],
    week:["本周",""],
    month:["月总览",`${monthTitle(addMonths(new Date(),calendarMonthOffset))} · 点日期看当天课程`]
  };
  setHead(labels[scheduleMode][0],labels[scheduleMode][1],classes.length+" classes");
  byId("tabs").innerHTML=renderScheduleControls();
  if(scheduleMode==="today") byId("content").innerHTML=renderTodayDesk(classes);
  if(scheduleMode==="week") byId("content").innerHTML=renderWeekCards(classes);
  if(scheduleMode==="month") byId("content").innerHTML=renderMonthCalendar(classes);
  bindTodayEvents();bindScheduleCards(classes);
}
function bindTodayEvents(){
  document.querySelectorAll("[data-scheduleMode]").forEach(b=>b.addEventListener("click",()=>{scheduleMode=b.dataset.schedulemode;render();}));
  document.querySelectorAll("[data-week-move]").forEach(b=>b.addEventListener("click",()=>{finalWeekOffset+=Number(b.dataset.weekMove)||0;render();}));
  document.querySelectorAll("[data-week-reset]").forEach(b=>b.addEventListener("click",()=>{finalWeekOffset=0;render();}));
  document.querySelectorAll("[data-month-day]").forEach(b=>b.addEventListener("click",()=>{monthSelectedDate=b.dataset.monthDay;render();}));
  document.querySelectorAll("[data-month-move]").forEach(b=>b.addEventListener("click",()=>{calendarMonthOffset+=Number(b.dataset.monthMove)||0;const base=addMonths(new Date(),calendarMonthOffset);monthSelectedDate=dateKey(new Date(base.getFullYear(),base.getMonth(),1));render();}));
}

/* Final month header cleanup */
function renderToday(){
  const classes=displayClasses();
  const labels={
    today:["今日","今天课程和最近要做的事"],
    week:["本周",""],
    month:["月总览",""]
  };
  setHead(labels[scheduleMode][0],labels[scheduleMode][1],classes.length+" classes");
  byId("tabs").innerHTML=renderScheduleControls();
  if(scheduleMode==="today") byId("content").innerHTML=renderTodayDesk(classes);
  if(scheduleMode==="week") byId("content").innerHTML=renderWeekCards(classes);
  if(scheduleMode==="month") byId("content").innerHTML=renderMonthCalendar(classes);
  bindTodayEvents();bindScheduleCards(classes);
}

function renderMonthCalendar(classes){
  const base=addMonths(new Date(),calendarMonthOffset);
  const first=new Date(base.getFullYear(),base.getMonth(),1);
  const last=new Date(base.getFullYear(),base.getMonth()+1,0);
  const offset=(first.getDay()+6)%7;
  const start=addDays(first,-offset);
  const cellCount=Math.ceil((offset+last.getDate())/7)*7;
  const cells=Array.from({length:cellCount},(_,i)=>addDays(start,i));
  const selected=parseLocalDate(monthSelectedDate)||new Date(base.getFullYear(),base.getMonth(),Math.min(new Date().getDate(),last.getDate()));
  const selectedItems=classesOnDate(classes,selected);
  return `<div class="month-overview refined-month">
    <section class="month-map">
      <div class="month-nav clean-month-nav">
        <button class="btn" data-month-move="-1" type="button">上个月</button>
        <b>${monthTitle(base)}</b>
        <button class="btn" data-month-move="1" type="button">下个月</button>
      </div>
      <div class="month-weekdays">${WORKDAYS.map(d=>`<b>${esc(d.replace("周",""))}</b>`).join("")}</div>
      <div class="month-dots-grid">${cells.map(d=>{
        const muted=d.getMonth()!==base.getMonth(),items=muted?[]:classesOnDate(classes,d),today=d.toDateString()===new Date().toDateString(),selectedDay=dateKey(d)===dateKey(selected);
        return `<button class="month-dot-cell ${muted?'muted':''} ${today?'today':''} ${selectedDay?'selected':''}" data-month-day="${safeAttr(dateKey(d))}" type="button"><b>${muted?'':d.getDate()}</b><span>${items.length?items.length+"节":""}</span><i>${items.map(x=>`<em class="${courseTone(x)}"></em>`).join("")}</i></button>`;
      }).join("")}</div>
    </section>
    <section class="month-detail">
      <div class="panel-head"><h3>${dateLabel(selected)} 课程</h3><span>${selectedItems.length} 节</span></div>
      <div class="month-detail-list">${selectedItems.map(renderMonthLesson).join("")||'<p class="no-class">这天没有课</p>'}</div>
    </section>
  </div>`;
}

/* Final clean month view: centered month title and no extra subtitle */
function renderToday(){
  const classes=displayClasses();
  const labels={
    today:["\u4eca\u65e5","\u4eca\u5929\u8bfe\u7a0b\u548c\u6700\u8fd1\u8981\u505a\u7684\u4e8b"],
    week:["\u672c\u5468",""],
    month:["\u6708\u603b\u89c8",""]
  };
  setHead(labels[scheduleMode][0],labels[scheduleMode][1],classes.length+" classes");
  byId("tabs").innerHTML=renderScheduleControls();
  if(scheduleMode==="today") byId("content").innerHTML=renderTodayDesk(classes);
  if(scheduleMode==="week") byId("content").innerHTML=renderWeekCards(classes);
  if(scheduleMode==="month") byId("content").innerHTML=renderMonthCalendar(classes);
  bindTodayEvents();
  bindScheduleCards(classes);
}

function renderMonthCalendar(classes){
  const base=addMonths(new Date(),calendarMonthOffset);
  const first=new Date(base.getFullYear(),base.getMonth(),1);
  const last=new Date(base.getFullYear(),base.getMonth()+1,0);
  const offset=(first.getDay()+6)%7;
  const start=addDays(first,-offset);
  const cellCount=Math.ceil((offset+last.getDate())/7)*7;
  const cells=Array.from({length:cellCount},(_,i)=>addDays(start,i));
  const selected=parseLocalDate(monthSelectedDate)||new Date(base.getFullYear(),base.getMonth(),Math.min(new Date().getDate(),last.getDate()));
  const selectedItems=classesOnDate(classes,selected);
  return `<div class="month-overview refined-month">
    <section class="month-map">
      <div class="month-nav clean-month-nav spread-month-nav">
        <button class="btn" data-month-move="-1" type="button">\u4e0a\u4e2a\u6708</button>
        <div class="month-center"><b>${monthTitle(base)}</b><button class="btn current-month-btn" data-month-current type="button">\u672c\u6708</button></div>
        <button class="btn" data-month-move="1" type="button">\u4e0b\u4e2a\u6708</button>
      </div>
      <div class="month-weekdays">${WORKDAYS.map(d=>`<b>${esc(d.replace("\u5468",""))}</b>`).join("")}</div>
      <div class="month-dots-grid">${cells.map(d=>{
        const muted=d.getMonth()!==base.getMonth();
        const items=muted?[]:classesOnDate(classes,d);
        const today=d.toDateString()===new Date().toDateString();
        const selectedDay=dateKey(d)===dateKey(selected);
        return `<button class="month-dot-cell ${muted?'muted':''} ${today?'today':''} ${selectedDay?'selected':''}" data-month-day="${safeAttr(dateKey(d))}" type="button"><b>${muted?'':d.getDate()}</b><span>${items.length?items.length+"\u8282":""}</span><i>${items.map(x=>`<em class="${courseTone(x)}"></em>`).join("")}</i></button>`;
      }).join("")}</div>
    </section>
    <section class="month-detail">
      <div class="panel-head"><h3>${dateLabel(selected)} \u8bfe\u7a0b</h3><span>${selectedItems.length} \u8282</span></div>
      <div class="month-detail-list">${selectedItems.map(renderMonthLesson).join("")||'<p class="no-class">\u8fd9\u5929\u6ca1\u6709\u8bfe\u3002</p>'}</div>
    </section>
  </div>`;
}

/* Final class detail cleanup: simpler Zoom, daily records, clearer tags */
function skippedDates(cls){
  const raw=cls.skippedDates||cls.breakDates||cls.pauseDates||[];
  if(Array.isArray(raw)) return raw.map(String);
  return String(raw||"").split(/[,\n，、]+/).map(x=>x.trim()).filter(Boolean);
}

function occurrenceInfo(cls,d){
  const total=Number(cls.totalLessons)||20;
  if(!cls.startDate) return {show:true,lesson:cls.lesson||"\u8fdb\u5ea6\u672a\u586b"};
  const start=parseLocalDate(cls.startDate);
  if(!start||d<start) return {show:false,lesson:""};
  const skipped=new Set(skippedDates(cls));
  let lessonNo=0;
  for(let day=new Date(start);day<=d;day=addDays(day,7)){
    if(!skipped.has(dateKey(day))) lessonNo++;
  }
  if(skipped.has(dateKey(d))) return {show:false,lesson:""};
  if(lessonNo<1||lessonNo>total) return {show:false,lesson:""};
  return {show:true,lesson:"\u7b2c "+lessonNo+"/"+total+" \u8bfe"};
}

function classRecordDate(item){
  return item._occurrenceDate||dateKey(new Date());
}

function classRecord(item){
  const date=classRecordDate(item);
  const records=Array.isArray(item.classRecords)?item.classRecords:[];
  return records.find(r=>r.date===date)||null;
}

function recordMaterials(item){
  const rec=classRecord(item);
  return (rec&&rec.materials)||item.homework||"";
}

function recordNotes(item){
  const rec=classRecord(item);
  return (rec&&rec.notes)||item.report||(item.notes&&item.notes[0]&&item.notes[0].text)||"";
}

function lessonNotebookText(item){
  return recordNotes(item)||recordMaterials(item)||"";
}

function colorFieldCard(label,value,tone){
  return `<div class="detail-line info-card ${tone||''}"><span>${esc(label)}</span><b>${esc(value||"\u672a\u586b")}</b></div>`;
}

function classDetailText(item){
  return `\u8001\u5e08\uff1a${item.teacher||"\u672a\u586b"}\n\u5b66\u751f\uff1a${item.students.map(s=>s.name).join("\u3001")||"\u6682\u65e0"}\n\u8bfe\u7a0b\uff1a${item.courseType||"\u672a\u586b"}\n\u8fdb\u5ea6\uff1a${lessonLabel(item)}\n\u4e3b\u9898\uff1a${item.topic||"\u672a\u586b"}\n\u72b6\u6001\uff1a${STATUS_LABELS[item.status]||"\u672a\u586b"}\nZoom\u8d26\u53f7\uff1a${zoomName(item)||"\u672a\u586b"}\n\n\u672c\u6b21\u7b14\u8bb0\uff1a${lessonNotebookText(item)||"\u672a\u586b"}`;
}

function classDetailHtml(item){
  const note=lessonNotebookText(item)||"\u8fd8\u6ca1\u6709\u586b\u5199\u3002";
  return `<div class="detail-section detail-info-section">
    <h4>\u4e0a\u8bfe\u4fe1\u606f</h4>
    <div class="detail-grid detail-info-grid">
      ${colorFieldCard("\u8001\u5e08",item.teacher,"info-teacher")}
      ${colorFieldCard("\u5b66\u751f",item.students.map(s=>s.name).join("\u3001")||"\u6682\u65e0","info-students")}
      ${colorFieldCard("\u8bfe\u7a0b",item.courseType,"info-course")}
      ${colorFieldCard("\u8fdb\u5ea6",lessonLabel(item),"info-progress")}
      ${colorFieldCard("\u4e3b\u9898",item.topic,"info-topic")}
      ${colorFieldCard("\u72b6\u6001",STATUS_LABELS[item.status],"info-status")}
      ${colorFieldCard("Zoom \u8d26\u53f7",zoomName(item),"info-zoom")}
    </div>
  </div>
  <div class="detail-section daily-record-section notebook-record-section">
    <h4>\u672c\u6b21\u7b14\u8bb0\u672c</h4>
    <div class="lesson-notebook"><span>\u8d44\u6599 / \u8bb0\u5f55</span><b>${esc(note)}</b></div>
  </div>`;
}

function openClassDetailModal(item){
  const isDemo=String(item.id||"").startsWith("demo-");
  byId("detailTags").innerHTML=`<span class="scene-tag detail-day-tag">${esc(item.weekday)}</span><span class="audience-tag detail-status-tag">${STATUS_LABELS[item.status]}</span><span class="audience-tag detail-time-tag">${esc(countdownText(item))}</span>`;
  byId("detailTitle").textContent=(item.time?formatTimeCN(item.time)+" \u00b7 ":"")+item.className;
  byId("detailContent").innerHTML=classDetailHtml(item);
  byId("detailOpenZoom").hidden=!item.zoomLink;
  byId("detailOpenZoom").onclick=()=>{if(item.zoomLink)window.open(item.zoomLink,"_blank");};
  byId("detailEdit").hidden=isDemo;
  byId("detailEdit").textContent="\u7f16\u8f91";
  byId("detailEdit").onclick=isDemo?null:()=>renderClassInlineEditor(item);
  byId("detailCopy").textContent="\u590d\u5236\u8bfe\u7a0b\u8be6\u60c5";
  byId("detailCopy").onclick=()=>copyText(classDetailText(item));
  byId("detailModal").classList.add("show");
  byId("detailModal").setAttribute("aria-hidden","false");
}

function renderClassInlineEditor(item){
  byId("detailTags").innerHTML=`<span class="scene-tag detail-day-tag">${esc(item.weekday)}</span><span class="audience-tag detail-status-tag">\u76f4\u63a5\u7f16\u8f91</span>`;
  byId("detailTitle").textContent="\u7f16\u8f91 \u00b7 "+item.className;
  byId("detailContent").innerHTML=`<div class="modal-edit-card"><div class="form-grid">
    <label class="field">\u661f\u671f<select id="modalWeekday">${WORKDAYS.map(v=>`<option value="${v}" ${item.weekday===v?'selected':''}>${v}</option>`).join("")}</select></label>
    <label class="field">\u65f6\u95f4<input id="modalTime" type="time" value="${safeAttr(item.time)}"></label>
    <label class="field">\u8bfe\u7a0b\u540d<input id="modalName" value="${safeAttr(item.className)}"></label>
    <label class="field">\u8001\u5e08<input id="modalTeacher" value="${safeAttr(item.teacher)}"></label>
    <label class="field">\u8bfe\u7a0b\u7c7b\u578b<input id="modalType" value="${safeAttr(item.courseType)}"></label>
    <label class="field">\u72b6\u6001<select id="modalStatus">${["Active","Paused","Archived"].map(v=>`<option value="${v}" ${item.status===v?'selected':''}>${STATUS_LABELS[v]}</option>`).join("")}</select></label>
    <label class="field">\u5f00\u8bfe\u65e5\u671f<input id="modalStartDate" type="date" value="${safeAttr(item.startDate)}"></label>
    <label class="field">\u603b\u8bfe\u6570<input id="modalTotalLessons" value="${safeAttr(item.totalLessons)}"></label>
    <label class="field">\u672c\u5468\u4e3b\u9898<input id="modalTopic" value="${safeAttr(item.topic)}"></label>
    <label class="field">Zoom \u8d26\u53f7<input id="modalZoomLabel" value="${safeAttr(item.zoomLabel)}"></label>
    <label class="field full">\u505c\u8bfe\u65e5\u671f\uff08\u4e00\u884c\u4e00\u4e2a\uff0c\u5982 2026-06-10\uff09<textarea id="modalSkippedDates">${esc(skippedDates(item).join('\n'))}</textarea></label>
    <label class="field full">\u5b66\u751f<textarea id="modalStudents">${esc((item.students||[]).map(s=>s.name+(s.note?' | '+s.note:'')).join('\n'))}</textarea></label>
    <label class="field full">\u672c\u6b21\u7b14\u8bb0\uff08\u8d44\u6599 / \u8bb0\u5f55\u653e\u8fd9\u91cc\uff09<textarea id="modalRecordNotes">${esc(lessonNotebookText(item))}</textarea></label>
  </div></div>`;
  byId("detailOpenZoom").hidden=true;
  byId("detailEdit").hidden=false;
  byId("detailEdit").textContent="\u53d6\u6d88";
  byId("detailEdit").onclick=()=>openClassDetailModal(item);
  byId("detailCopy").textContent="\u4fdd\u5b58\u8bfe\u7a0b";
  byId("detailCopy").onclick=()=>saveInlineClass(item.id,item);
}

function saveInlineClass(id,sourceItem){
  const existing=scheduleData.find(x=>x.id===id);
  if(!existing) return;
  const date=classRecordDate(sourceItem||existing);
  const notes=byId("modalRecordNotes").value.trim();
  const materials=notes;
  const records=Array.isArray(existing.classRecords)?existing.classRecords.slice():[];
  const recordIndex=records.findIndex(r=>r.date===date);
  const nextRecord={date,materials,notes,updatedAt:new Date().toISOString()};
  if(recordIndex>=0) records[recordIndex]={...records[recordIndex],...nextRecord};
  else records.push(nextRecord);
  const item=normalizeClassItem({
    ...existing,
    weekday:byId("modalWeekday").value,
    time:byId("modalTime").value,
    className:byId("modalName").value||"\u672a\u547d\u540d\u8bfe\u7a0b",
    teacher:byId("modalTeacher").value,
    courseType:byId("modalType").value,
    status:byId("modalStatus").value,
    startDate:byId("modalStartDate").value,
    totalLessons:byId("modalTotalLessons").value,
    topic:byId("modalTopic").value,
    zoomLabel:byId("modalZoomLabel").value,
    students:parseStudents(byId("modalStudents").value),
    homework:materials,
    report:notes,
    notes:existing.notes
  });
  item.skippedDates=byId("modalSkippedDates").value.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  item.classRecords=records;
  if(notes){
    if(item.notes[0]){item.notes[0].text=notes;item.notes[0].updatedAt=new Date().toISOString();}
    else item.notes.unshift({id:uid("note"),text:notes,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
  const idx=scheduleData.findIndex(x=>x.id===id);
  scheduleData[idx]={...scheduleData[idx],...item};
  saveSchedule();
  showToast("\u5df2\u4fdd\u5b58\u672c\u6b21\u8bfe\u7a0b\u8bb0\u5f55");
  render();
  const refreshed=classesOnDate([scheduleData[idx]],parseLocalDate(date)||new Date())[0]||scheduleData[idx];
  openClassDetailModal(refreshed);
}

/* Final readable week lesson card */
function renderWeekLesson(x){
  const status=cleanStatusList(x);
  const zoom=zoomName(x);
  return `<button class="week-lesson vertical-note readable-week-note ${courseTone(x)}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button">
    <div class="note-tape"></div>
    <span class="week-lesson-time">${esc(formatTimeCN(x.time))}</span>
    <b>${esc(x.className)}</b>
    <span class="week-info-row">${esc(x.teacher||"\u672a\u586b\u8001\u5e08")} \u00b7 ${x.students.length||0} \u4eba \u00b7 ${esc(lessonLabel(x))}</span>
    <span class="week-zoom-pill">${zoom?esc(zoom):"\u672a\u586b Zoom"}</span>
    ${status.length?`<i>${status.map(esc).join(" \u00b7 ")}</i>`:""}
  </button>`;
}

/* Final today board: daily todo notebook + softer course cards */
var todoDateOffset=0;
const DAILY_TODO_KEY="dailyTodos";

function todoDate(){
  return addDays(new Date(),todoDateOffset||0);
}

function daysBetween(a,b){
  const aa=new Date(a.getFullYear(),a.getMonth(),a.getDate());
  const bb=new Date(b.getFullYear(),b.getMonth(),b.getDate());
  return Math.round((aa-bb)/86400000);
}

function readDailyTodos(){
  try{
    let parsed=JSON.parse(localStorage.getItem(DAILY_TODO_KEY)||"{}");
    // 历史数据可能被双重编码成字符串，再解一层
    if(typeof parsed==="string") parsed=JSON.parse(parsed);
    // 必须是 {日期: [待办...]} 形式的对象；字符串/数组等坏格式一律重置
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)) return {};
    return parsed;
  }catch(e){return {};}
}

function saveDailyTodos(day,todos){
  const all=readDailyTodos();
  all[dateKey(day)]=todos;
  localStorage.setItem(DAILY_TODO_KEY,JSON.stringify(all));
  syncToCloud();
}

function defaultTodosForDay(day,items){
  // \u4e0d\u81ea\u52a8\u751f\u6210\uff0c\u5f85\u529e\u53ea\u80fd\u7531\u7528\u6237\u624b\u52a8\u8f93\u5165
  return [];
}

function todosForDay(day,items){
  const all=readDailyTodos();
  const dk=dateKey(day);
  const saved=all[dk];
  if(Array.isArray(saved)) return saved;
  return [];
}

// 查找所有日期里关联某节课的未完成待办（课程卡用）
function allPendingTodosForClass(classId){
  const all=readDailyTodos();
  const result=[];
  Object.values(all).forEach(todos=>{
    if(Array.isArray(todos)){
      todos.filter(t=>!t.done&&t.classLink&&t.classLink.startsWith(classId))
           .forEach(t=>result.push(t));
    }
  });
  return result;
}

// 按日期分组查找关联某节课的所有待办（含已完成，历史页用）
function allTodosForClassByDate(classId){
  const all=readDailyTodos();
  const byDate={};
  Object.entries(all).forEach(([date,todos])=>{
    if(!Array.isArray(todos)) return;
    const linked=todos.filter(t=>t.classLink&&t.classLink.startsWith(classId));
    if(linked.length) byDate[date]=linked;
  });
  return byDate;
}

/* renderTodoNotebook \u7684\u552f\u4e00\u5b9e\u73b0\u5728\u6587\u4ef6\u672b\u5c3e"\u7edf\u4e00 TODO \u5904\u7406"\u533a\u57df */

function renderTodayCourseCard(x){
  const status=cleanStatusList(x);
  const zoom=zoomName(x)||"\u672a\u586b Zoom";
  return `<button class="today-course-card clean-course-note ${courseTone(x)}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button">
    <span class="today-course-time">${esc(formatTimeCN(x.time))}</span>
    <b>${esc(x.className)}</b>
    <p>${esc(x.teacher||"\u672a\u586b\u8001\u5e08")} \u00b7 ${x.students.length||0} \u4eba \u00b7 ${esc(lessonLabel(x))}</p>
    <div class="today-course-bottom">
      <span>${esc(zoom)}</span>
      ${status.length?`<i>${status.map(esc).join(" \u00b7 ")}</i>`:""}
    </div>
  </button>`;
}

function nextClassOccurrence(x,from=new Date()){
  // 最多往前看 (totalLessons+5)*7 天，找到第一个有效上课日
  const maxDays=Math.min(((Number(x.totalLessons)||20)+5)*7,370);
  for(let i=0;i<=maxDays;i++){
    const d=addDays(from,i);
    const items=classesOnDate([x],d);
    if(items.length) return items[0];
  }
  return null; // 课程已结束，没有下一次
}

function renderRecentCourseCard(x){
  const occ=nextClassOccurrence(x);
  const d=parseLocalDate(x._occurrenceDate)||(occ&&parseLocalDate(occ._occurrenceDate));
  if(!d) return ""; // 课程已结束，不渲染
  const dayText=`${todayName(daysBetween(d,new Date()))} ${d.getMonth()+1}/${d.getDate()}`;
  return `<button class="recent-course-card ${courseTone(x)}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button">
    <span class="recent-date">${esc(dayText)}</span>
    <b>${esc(formatTimeCN(x.time))} \u00b7 ${esc(x.className)}</b>
    <small>${esc(x.teacher||"\u672a\u586b\u8001\u5e08")} \u00b7 ${x.students.length||0} \u4eba \u00b7 ${esc(lessonLabel(x))}</small>
  </button>`;
}

function renderTodayDesk(classes){
  const day=todoDate();
  const dayItems=classesOnDate(classes,day);
  const todos=todosForDay(day,dayItems);
  const upcoming=classes.map(x=>nextClassOccurrence(x)).filter(Boolean).sort((a,b)=>{
    const ad=parseLocalDate(a._occurrenceDate)||new Date();
    const bd=parseLocalDate(b._occurrenceDate)||new Date();
    return ad-bd||timeMinutes(a.time)-timeMinutes(b.time);
  }).slice(0,6);
  const renderCard=(x)=>{
    const linked=allPendingTodosForClass(x.id); // 跨所有日期查找关联待办
    return renderTodayCourseCard(x,linked);
  };
  return `<div class="today-board clean-today todo-today">
    ${renderTodoNotebook(day,dayItems)}
    <section class="today-panel today-lesson-panel">
      <div class="panel-head"><h3>${dateKey(day)===dateKey(new Date())?"\u4eca\u5929\u8bfe\u7a0b":dateLabel(day)+" \u8bfe\u7a0b"}</h3><span>${dayItems.length} \u8282</span></div>
      <div class="today-course-list pretty-course-list">${dayItems.map(renderCard).join("")||'<div class="today-empty-card"><b>\u8fd9\u5929\u6ca1\u6709\u8bfe</b><span>\u53ef\u4ee5\u7528\u5de6\u8fb9\u5f85\u529e\u8bb0\u5f55\u8981\u5904\u7406\u7684\u5c0f\u4e8b\u3002</span></div>'}</div>
    </section>
    <section class="today-panel compact">
      <div class="panel-head"><h3>\u6700\u8fd1\u8bfe\u7a0b</h3><span>\u4ece\u4eca\u5929\u5f80\u540e</span></div>
      <div class="recent-index today-recent-cards">${upcoming.map(renderRecentCourseCard).join("")}</div>
    </section>
  </div>`;
}

function bindTodayEvents(){
  document.querySelectorAll("[data-scheduleMode]").forEach(b=>b.addEventListener("click",()=>{scheduleMode=b.dataset.schedulemode;render();}));
  document.querySelectorAll("[data-week-move]").forEach(b=>b.addEventListener("click",()=>{finalWeekOffset+=Number(b.dataset.weekMove)||0;render();}));
  document.querySelectorAll("[data-week-reset]").forEach(b=>b.addEventListener("click",()=>{finalWeekOffset=0;render();}));
  document.querySelectorAll("[data-month-move]").forEach(b=>b.addEventListener("click",()=>{calendarMonthOffset+=Number(b.dataset.monthMove);monthSelectedDate="";render();}));
  document.querySelectorAll("[data-month-current]").forEach(b=>b.addEventListener("click",()=>{calendarMonthOffset=0;monthSelectedDate=dateKey(new Date());render();}));
  document.querySelectorAll("[data-month-day]").forEach(b=>b.addEventListener("click",()=>{monthSelectedDate=b.dataset.monthDay;render();}));
  document.querySelectorAll("[data-todo-move]").forEach(b=>b.addEventListener("click",()=>{todoDateOffset+=Number(b.dataset.todoMove);render();}));
  const picker=byId("todoDatePicker");
  if(picker) picker.addEventListener("change",()=>{const picked=parseLocalDate(picker.value);if(picked){todoDateOffset=daysBetween(picked,new Date());render();}});
  const day=todoDate();
  const items=classesOnDate(displayClasses(),day);
  const todos=todosForDay(day,items);
  document.querySelectorAll("[data-todo-toggle]").forEach(b=>b.addEventListener("click",()=>{
    const i=Number(b.dataset.todoToggle);
    if(todos[i]){todos[i].done=!todos[i].done;saveDailyTodos(day,todos);render();}
  }));
  document.querySelectorAll("[data-todo-delete]").forEach(b=>b.addEventListener("click",()=>{
    const i=Number(b.dataset.todoDelete);
    todos.splice(i,1);saveDailyTodos(day,todos);render();
  }));
  const add=byId("todoAdd"),input=byId("todoInput");
  const addTodo=()=>{const text=(input&&input.value||"").trim();if(!text)return;todos.push({id:uid("todo"),text,done:false});saveDailyTodos(day,todos);render();};
  if(add) add.addEventListener("click",addTodo);
  if(input) input.addEventListener("keydown",e=>{if(e.key==="Enter")addTodo();});
}

/* Final manage cleanup: compact filters, visible notes, course type search. */
var manageClassSearch="";
var manageClassType="all";
var manageClassRecordDate="";
const CLASS_TYPE_FILTERS=[
  {value:"LR",label:"LR"},
  {value:"CW",label:"CW"},
  {value:"CR",label:"CR"},
  {value:"EW",label:"EW"}
];
const TERM_OPTIONS=["上半年","下半年","假期营","1对1"];

function formVal(id){
  const el=byId(id);
  return el?el.value:"";
}

function courseCode(x){
  const text=((x.courseType||"")+" "+(x.className||"")).toLowerCase();
  if(/\blr\b|精读|literature|reading/.test(text)) return "LR";
  if(/\bcw\b|创意|creative/.test(text)) return "CW";
  if(/\bcr\b|中文|趣味|chinese/.test(text)) return "CR";
  if(/\bew\b|议论|思辨|essay|argument/.test(text)) return "EW";
  return "";
}

function courseTypeLabel(x){
  return courseCode(x)||x.courseType||"未分类";
}

function classTermLabel(x){
  if(x.term) return x.term;
  if(x.status==="Archived") return "归档";
  if(x.status==="Deleted") return "回收站";
  return "上半年";
}

function courseTone(x){
  const code=courseCode(x);
  if(code==="LR") return "ocean";
  if(code==="CW") return "coral";
  if(code==="CR") return "leaf";
  if(code==="EW") return "sky";
  return "leaf";
}

function filterClassesForManage(list){
  const keyword=(manageClassSearch||"").trim().toLowerCase();
  return list.filter(x=>{
    if(manageClassType!=="all" && courseCode(x)!==manageClassType) return false;
    if(!keyword) return true;
    const studentText=(x.students||[]).map(s=>s.name+" "+(s.note||"")).join(" ");
    return [x.className,x.teacher,x.courseType,x.zoomLabel,studentText,x.topic].join(" ").toLowerCase().includes(keyword);
  });
}

function classTypeFilterBar(){
  const tabs=[{value:"all",label:"全部"},...CLASS_TYPE_FILTERS];
  return `<div class="class-type-filter">${tabs.map(t=>`<button class="tab ${manageClassType===t.value?'active':''}" data-manage-class-type="${t.value}" type="button">${t.label}</button>`).join("")}</div>`;
}

function latestClassRecordDate(x){
  const records=Array.isArray(x&&x.classRecords)?x.classRecords.slice():[];
  records.sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  return records[0]&&records[0].date?records[0].date:dateKey(new Date());
}

function classRecordTextForDate(x,date){
  const records=Array.isArray(x&&x.classRecords)?x.classRecords:[];
  const found=records.find(r=>r.date===date);
  if(found) return found.notes||found.materials||"";
  return "";
}

function formatDateShort(value){
  const d=parseLocalDate(value);
  return d?`${d.getMonth()+1}/${d.getDate()}`:(value||"");
}

function classRecordHistoryHtml(x,selectedDate){
  const records=(Array.isArray(x&&x.classRecords)?x.classRecords.slice():[])
    .filter(r=>r.date)
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)))
    .slice(0,10);
  if(!records.length) return `<div class="record-history empty">还没有保存过当天记录。</div>`;
  return `<div class="record-history"><b>已保存记录</b><div class="record-chip-grid">${records.map(r=>`<button class="record-chip ${r.date===selectedDate?'active':''}" type="button" data-load-class-record="${safeAttr(r.date)}"><span>${esc(formatDateShort(r.date))}</span><small>${esc((r.notes||r.materials||"空记录").slice(0,32))}</small></button>`).join("")}</div></div>`;
}

function renderStickerCard(x){
  const note=(x.note||"").trim();
  return `<article class="sticker-card ${x.scene}"><button class="sticker-open" data-detail-id="${safeAttr(x.id)}" type="button"><div class="tag-row"><span class="scene-tag">${SCENE_LABELS[x.scene]}</span><span class="audience-tag">${AUDIENCE_LABELS[x.audience]}</span></div><b>${esc(x.title)}</b>${note?`<small class="sticker-note">${esc(note)}</small>`:""}<p>${esc(x.content)}</p></button><button class="copy-badge" data-copy-id="${safeAttr(x.id)}" type="button">复制</button></article>`;
}

function openStickerDetail(item){
  const note=(item.note||"").trim();
  byId("detailTags").innerHTML=`<span class="scene-tag">${SCENE_LABELS[item.scene]}</span><span class="audience-tag">${AUDIENCE_LABELS[item.audience]}</span>`;
  byId("detailTitle").textContent=item.title;
  byId("detailContent").innerHTML=`${note?`<div class="sticker-note-detail"><span>备注</span><b>${esc(note)}</b></div>`:""}<div class="sticker-fulltext">${esc(item.content)}</div>`;
  byId("detailOpenZoom").hidden=true;
  byId("detailEdit").hidden=true;
  byId("detailCopy").textContent="复制这条话术";
  byId("detailCopy").onclick=()=>copyText(item.content);
  byId("detailModal").classList.add("show");
  byId("detailModal").setAttribute("aria-hidden","false");
}

function renderStickerManage(){
  const list=filterStickersWithSearch(stickersData.filter(x=>!x.deletedAt),manageStickerScene,manageStickerAudience,manageStickerSearch);
  const current=stickersData.find(x=>x.id===editingStickerId)||null;
  byId("content").innerHTML=`<div class="manage-layout sticker-manage compact-manage"><section class="list-panel"><div class="panel-head"><h3>找话术</h3><button class="btn primary" data-new-sticker>新增</button></div><input class="search-input" id="manageStickerSearch" value="${safeAttr(manageStickerSearch)}" placeholder="搜索标题、内容或备注"><div class="manage-filter">${filterBar("manageSticker",manageStickerScene,manageStickerAudience)}</div><div class="item-list card-list">${list.map(x=>{const note=(x.note||"").trim();return `<button class="list-item ${x.id===editingStickerId?'active':''}" data-edit-sticker="${safeAttr(x.id)}"><b>${esc(x.title)}</b><span>${SCENE_LABELS[x.scene]} · ${AUDIENCE_LABELS[x.audience]}${x.archivedAt?' · 已归档':''}</span>${note?`<small class="list-note">${esc(note)}</small>`:""}</button>`}).join("")||'<p class="empty">这个分类里没有话术。</p>'}</div></section><section class="edit-panel preview-edit">${stickerForm(current)}</section></div>`;
}

function stickerForm(x){
  x=x||{scene:"before",audience:"group",title:"",content:"",note:""};
  return `<h3>${x.id?'编辑话术':'新增话术'}</h3><div class="sticker-editor-grid"><div class="form-grid"><label class="field">标题<input id="stickerTitle" value="${safeAttr(x.title)}"></label><label class="field">场景<select id="stickerScene">${SCENES.map(v=>`<option value="${v}" ${x.scene===v?'selected':''}>${SCENE_LABELS[v]}</option>`).join("")}</select></label><label class="field">发给<select id="stickerAudience">${AUDIENCES.map(v=>`<option value="${v}" ${x.audience===v?'selected':''}>${AUDIENCE_LABELS[v]}</option>`).join("")}</select></label><label class="field">备注<input id="stickerNote" value="${safeAttr(x.note||"")}" placeholder="可写用途、班级、注意点"></label><label class="field full">内容<textarea id="stickerContent">${esc(x.content||"")}</textarea></label></div><aside class="live-preview"><span>预览</span><b>${esc(x.title||"新话术标题")}</b>${x.note?`<small>${esc(x.note)}</small>`:""}<p>${esc(x.content||"这里会显示话术内容，保存后会变成话术卡片。")}</p></aside></div><div class="form-actions"><button class="btn primary" data-save-sticker>保存</button>${x.id?'<button class="btn ghost" data-archive-sticker>归档</button><button class="btn danger" data-delete-sticker>删除</button>':''}</div>`;
}

function renderClassManage(){
  const source=scheduleData.filter(x=>x.status!=="Deleted");
  const list=filterClassesForManage(source);
  const current=scheduleData.find(x=>x.id===editingClassId)||null;
  byId("content").innerHTML=`<div class="manage-layout class-manage compact-manage upgraded-class-manage"><section class="list-panel"><div class="panel-head"><h3>找课程</h3><button class="btn primary compact-add" data-new-class>新建课程</button></div><input class="search-input" id="manageClassSearch" value="${safeAttr(manageClassSearch)}" placeholder="搜索课程、老师、学生、Zoom">${classTypeFilterBar()}<div class="item-list card-list">${list.map(x=>`<button class="list-item course-list-item ${x.id===editingClassId?'active':''}" data-edit-class="${safeAttr(x.id)}"><b>${esc(x.weekday)} ${esc(formatTimeCN(x.time)||"未定")} · ${esc(x.className)}</b><span>${esc(courseTypeLabel(x))} · ${esc(x.teacher||"未填老师")} · ${esc(classTermLabel(x))}</span></button>`).join("")||'<p class="empty">这里没有找到课程。</p>'}</div></section><section class="edit-panel preview-edit">${classForm(current)}</section></div>`;
}

function classForm(x){
  x=x||{weekday:"周一",time:"",teacher:"",courseType:"LR",className:"",status:"Active",term:"上半年",students:[],notes:[],zoomLabel:"",lesson:"",topic:"",totalLessons:"20",startDate:"",homework:"",report:""};
  const code=courseCode(x)||x.courseType||"LR";
  const term=x.term||"上半年";
  const selectedDate=manageClassRecordDate||latestClassRecordDate(x);
  const recordText=classRecordTextForDate(x,selectedDate)||lessonNotebookText(x);
  return `<h3>${x.id?'编辑课程':'新增课程'}</h3><p class="form-hint">先填课程卡；日期和停课日会帮你自动算第几课。</p><div class="course-editor-clean"><div class="form-section full course-card-section"><b>课程卡</b><div class="form-grid inner"><label class="field">星期<select id="classWeekday">${WORKDAYS.map(v=>`<option value="${v}" ${x.weekday===v?'selected':''}>${v}</option>`).join("")}</select></label><label class="field">时间<input id="classTime" type="time" value="${safeAttr(x.time)}"></label><label class="field">课程名<input id="className" value="${safeAttr(x.className)}" placeholder="如：英文精读 HP3"></label><label class="field">老师<input id="classTeacher" value="${safeAttr(x.teacher)}"></label><label class="field">分类<select id="classCourseType">${CLASS_TYPE_FILTERS.map(t=>`<option value="${t.value}" ${code===t.value?'selected':''}>${t.value}</option>`).join("")}</select></label><label class="field">学期<select id="classTerm">${TERM_OPTIONS.map(v=>`<option value="${v}" ${term===v?'selected':''}>${v}</option>`).join("")}</select></label></div></div><div class="form-section progress-section"><b>自动进度</b><div class="form-grid inner two"><label class="field">开课日期<input id="classStartDate" type="date" value="${safeAttr(x.startDate)}"></label><label class="field">总课数<input id="classTotalLessons" value="${safeAttr(x.totalLessons||"20")}" placeholder="20"></label><label class="field full">停课日期<textarea id="classSkippedDates" placeholder="一行一个日期，如 2026-06-10">${esc(skippedDates(x).join('\n'))}</textarea></label><label class="field full">本周主题<input id="classTopic" value="${safeAttr(x.topic)}" placeholder="如：Harry Potter 3"></label></div></div><div class="form-section zoom-compact-section"><b>Zoom 账号</b><label class="field full"><input id="classZoomLabel" value="${safeAttr(x.zoomLabel)}" placeholder="zoom1 / zoom2 / camp / siyanci"></label></div><label class="field full students-section">学生<textarea id="classStudents" placeholder="每行一个学生；可写：姓名 | 备注">${esc((x.students||[]).map(s=>s.name+(s.note?' | '+s.note:'')).join('\n'))}</textarea></label><div class="form-section full notebook-editor-section"><b>当天记录本</b><div class="record-date-row"><label class="field">记录日期<input id="classRecordDate" type="date" value="${safeAttr(selectedDate)}"></label><span>这一天的资料、作业、课堂记录都写在这里；保存后会留在历史里。</span></div><label class="field full">记录内容<textarea id="classReport" placeholder="例如：今天讲了什么、作业是什么、孩子表现、下次提醒">${esc(recordText)}</textarea></label>${classRecordHistoryHtml(x,selectedDate)}</div></div><div class="form-actions"><button class="btn primary" data-save-class>保存</button>${x.id?'<button class="btn ghost" data-archive-class>归档</button><button class="btn danger" data-delete-class>删除</button>':''}</div>`;
}

function saveClassFromForm(){
  const existing=scheduleData.find(x=>x.id===editingClassId);
  const report=formVal("classReport").trim();
  const recordDate=formVal("classRecordDate")||manageClassRecordDate||dateKey(new Date());
  const records=existing&&Array.isArray(existing.classRecords)?existing.classRecords.slice():[];
  const recordIndex=records.findIndex(r=>r.date===recordDate);
  if(report || recordIndex>=0){
    const nextRecord={date:recordDate,materials:report,notes:report,updatedAt:new Date().toISOString()};
    if(recordIndex>=0) records[recordIndex]={...records[recordIndex],...nextRecord};
    else records.push(nextRecord);
  }
  const item=normalizeClassItem({
    ...(existing||{}),
    id:editingClassId||uid("class"),
    weekday:formVal("classWeekday")||"周一",
    time:formVal("classTime"),
    className:formVal("className")||"未命名课程",
    teacher:formVal("classTeacher"),
    courseType:formVal("classCourseType")||"LR",
    status:existing&&existing.status==="Archived"?"Archived":"Active",
    students:parseStudents(formVal("classStudents")),
    zoomLabel:formVal("classZoomLabel"),
    lesson:existing?existing.lesson:"",
    topic:formVal("classTopic"),
    totalLessons:formVal("classTotalLessons")||"20",
    startDate:formVal("classStartDate"),
    homework:report,
    report,
    notes:existing?existing.notes:[]
  });
  item.term=formVal("classTerm")||"上半年";
  item.zoomLink=existing?existing.zoomLink||"":"";
  item.zoomId=existing?existing.zoomId||"":"";
  item.zoomPassword=existing?existing.zoomPassword||"":"";
  item.skippedDates=formVal("classSkippedDates").split(/\n+/).map(x=>x.trim()).filter(Boolean);
  item.classRecords=records;
  if(report){
    if(item.notes[0]){item.notes[0].text=report;item.notes[0].updatedAt=new Date().toISOString();}
    else item.notes.unshift({id:uid("note"),text:report,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
  const idx=scheduleData.findIndex(x=>x.id===editingClassId);
  if(idx>=0) scheduleData[idx]={...scheduleData[idx],...item};
  else scheduleData.push(item);
  editingClassId=item.id;
  manageClassRecordDate=recordDate;
  saveSchedule();
  showToast("已保存课程");
  render();
}

function classDetailText(item){
  return `老师：${item.teacher||"未填"}\n学生：${item.students.map(s=>s.name).join("、")||"暂无"}\n课程：${item.courseType||"未填"}\n进度：${lessonLabel(item)}\n主题：${item.topic||"未填"}\n学期：${classTermLabel(item)}\n\nZoom账号：${zoomName(item)||"未填"}\n\n课程笔记：${lessonNotebookText(item)||"未填"}`;
}

function classDetailHtml(item){
  return `<div class="detail-section"><h4>上课信息</h4><div class="detail-grid detail-grid-colored">${fieldCard("老师",item.teacher)}${fieldCard("学生",item.students.map(s=>s.name).join("、")||"暂无")}${fieldCard("课程",item.courseType)}${fieldCard("进度",lessonLabel(item))}${fieldCard("主题",item.topic)}${fieldCard("学期",classTermLabel(item))}</div></div><div class="detail-section single-account-section">${fieldCard("Zoom 账号",zoomName(item))}</div><div class="detail-section daily-record-section notebook-section">${fieldCard("课程笔记",lessonNotebookText(item),true)}</div>`;
}

function openClassDetailModal(item){
  const isDemo=String(item.id||"").startsWith("demo-");
  byId("detailTags").innerHTML=`<span class="scene-tag detail-day-tag">${esc(item.weekday)}</span><span class="audience-tag detail-status-tag">${esc(classTermLabel(item))}</span><span class="audience-tag detail-time-tag">${esc(countdownText(item))}</span>`;
  byId("detailTitle").textContent=(item.time?formatTimeCN(item.time)+" · ":"")+item.className;
  byId("detailContent").innerHTML=classDetailHtml(item);
  byId("detailOpenZoom").hidden=true;
  byId("detailEdit").hidden=isDemo;
  byId("detailEdit").textContent="编辑";
  byId("detailEdit").onclick=isDemo?null:()=>renderClassInlineEditor(item);
  byId("detailCopy").textContent="复制课程详情";
  byId("detailCopy").onclick=()=>copyText(classDetailText(item));
  byId("detailModal").classList.add("show");
  byId("detailModal").setAttribute("aria-hidden","false");
}

function renderClassInlineEditor(item){
  byId("detailTags").innerHTML=`<span class="scene-tag detail-day-tag">${esc(item.weekday)}</span><span class="audience-tag detail-status-tag">直接编辑</span>`;
  byId("detailTitle").textContent="编辑 · "+item.className;
  const code=courseCode(item)||item.courseType||"LR";
  byId("detailContent").innerHTML=`<div class="modal-edit-card"><div class="form-grid">
    <label class="field">星期<select id="modalWeekday">${WORKDAYS.map(v=>`<option value="${v}" ${item.weekday===v?'selected':''}>${v}</option>`).join("")}</select></label>
    <label class="field">时间<input id="modalTime" type="time" value="${safeAttr(item.time)}"></label>
    <label class="field">课程名<input id="modalName" value="${safeAttr(item.className)}"></label>
    <label class="field">老师<input id="modalTeacher" value="${safeAttr(item.teacher)}"></label>
    <label class="field">分类<select id="modalType">${CLASS_TYPE_FILTERS.map(t=>`<option value="${t.value}" ${code===t.value?'selected':''}>${t.value}</option>`).join("")}</select></label>
    <label class="field">学期<select id="modalTerm">${TERM_OPTIONS.map(v=>`<option value="${v}" ${(item.term||"上半年")===v?'selected':''}>${v}</option>`).join("")}</select></label>
    <label class="field">开课日期<input id="modalStartDate" type="date" value="${safeAttr(item.startDate)}"></label>
    <label class="field">总课数<input id="modalTotalLessons" value="${safeAttr(item.totalLessons)}"></label>
    <label class="field">本周主题<input id="modalTopic" value="${safeAttr(item.topic)}"></label>
    <label class="field">Zoom 账号<input id="modalZoomLabel" value="${safeAttr(item.zoomLabel)}"></label>
    <label class="field full">停课日期<textarea id="modalSkippedDates">${esc(skippedDates(item).join('\n'))}</textarea></label>
    <label class="field full">学生<textarea id="modalStudents">${esc((item.students||[]).map(s=>s.name+(s.note?' | '+s.note:'')).join('\n'))}</textarea></label>
    <label class="field full">课程笔记<textarea id="modalRecordNotes">${esc(lessonNotebookText(item))}</textarea></label>
  </div></div>`;
  byId("detailOpenZoom").hidden=true;
  byId("detailEdit").hidden=false;
  byId("detailEdit").textContent="取消";
  byId("detailEdit").onclick=()=>openClassDetailModal(item);
  byId("detailCopy").textContent="保存课程";
  byId("detailCopy").onclick=()=>saveInlineClass(item.id,item);
}

function saveInlineClass(id,sourceItem){
  const existing=scheduleData.find(x=>x.id===id);
  if(!existing) return;
  const date=classRecordDate(sourceItem||existing);
  const notes=formVal("modalRecordNotes").trim();
  const records=Array.isArray(existing.classRecords)?existing.classRecords.slice():[];
  const recordIndex=records.findIndex(r=>r.date===date);
  if(notes){
    const nextRecord={date,materials:notes,notes,updatedAt:new Date().toISOString()};
    if(recordIndex>=0) records[recordIndex]={...records[recordIndex],...nextRecord};
    else records.push(nextRecord);
  }
  const item=normalizeClassItem({
    ...existing,
    weekday:formVal("modalWeekday"),
    time:formVal("modalTime"),
    className:formVal("modalName")||"未命名课程",
    teacher:formVal("modalTeacher"),
    courseType:formVal("modalType"),
    status:existing.status==="Archived"?"Archived":"Active",
    startDate:formVal("modalStartDate"),
    totalLessons:formVal("modalTotalLessons"),
    topic:formVal("modalTopic"),
    zoomLabel:formVal("modalZoomLabel"),
    students:parseStudents(formVal("modalStudents")),
    homework:notes,
    report:notes,
    notes:existing.notes
  });
  item.term=formVal("modalTerm")||"上半年";
  item.skippedDates=formVal("modalSkippedDates").split(/\n+/).map(x=>x.trim()).filter(Boolean);
  item.classRecords=records;
  if(notes){
    if(item.notes[0]){item.notes[0].text=notes;item.notes[0].updatedAt=new Date().toISOString();}
    else item.notes.unshift({id:uid("note"),text:notes,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
  const idx=scheduleData.findIndex(x=>x.id===id);
  scheduleData[idx]={...scheduleData[idx],...item};
  saveSchedule();
  showToast("已保存课程");
  render();
  const refreshed=classesOnDate([scheduleData[idx]],parseLocalDate(date)||new Date())[0]||scheduleData[idx];
  openClassDetailModal(refreshed);
}

function bindManageEvents(){
  document.querySelectorAll("[data-manage]").forEach(b=>b.addEventListener("click",()=>{manageMode=b.dataset.manage;editingStickerId=null;editingClassId=null;render();}));
  document.querySelectorAll("[data-manage-go]").forEach(b=>b.addEventListener("click",()=>{manageMode=b.dataset.manageGo;render();}));
  document.querySelectorAll("[data-manageStickerScene]").forEach(b=>b.addEventListener("click",()=>{manageStickerScene=b.dataset.managestickerscene;editingStickerId=null;render();}));
  document.querySelectorAll("[data-manageStickerAudience]").forEach(b=>b.addEventListener("click",()=>{manageStickerAudience=b.dataset.managestickeraudience;editingStickerId=null;render();}));
  document.querySelectorAll("[data-manage-class-type]").forEach(b=>b.addEventListener("click",()=>{manageClassType=b.dataset.manageClassType;editingClassId=null;manageClassRecordDate="";render();}));
  const ms=byId("manageStickerSearch");
  if(ms) ms.addEventListener("input",()=>{manageStickerSearch=ms.value;render();});
  const cs=byId("manageClassSearch");
  if(cs) cs.addEventListener("input",()=>{manageClassSearch=cs.value;render();});
  document.querySelectorAll("[data-edit-sticker]").forEach(b=>b.addEventListener("click",()=>{editingStickerId=b.dataset.editSticker;render();}));
  document.querySelectorAll("[data-new-sticker]").forEach(b=>b.addEventListener("click",()=>{editingStickerId=null;render();}));
  document.querySelectorAll("[data-save-sticker]").forEach(b=>b.addEventListener("click",saveStickerFromForm));
  document.querySelectorAll("[data-archive-sticker]").forEach(b=>b.addEventListener("click",()=>{const x=stickersData.find(s=>s.id===editingStickerId);if(x){x.archivedAt=x.archivedAt?"":new Date().toISOString();saveStickers();render();}}));
  document.querySelectorAll("[data-delete-sticker]").forEach(b=>b.addEventListener("click",()=>{const x=stickersData.find(s=>s.id===editingStickerId);if(x){x.deletedAt=new Date().toISOString();editingStickerId=null;saveStickers();render();}}));
  document.querySelectorAll("[data-edit-class]").forEach(b=>b.addEventListener("click",()=>{editingClassId=b.dataset.editClass;manageClassRecordDate="";render();}));
  document.querySelectorAll("[data-new-class]").forEach(b=>b.addEventListener("click",()=>{editingClassId=null;manageClassRecordDate="";render();}));
  document.querySelectorAll("[data-load-class-record]").forEach(b=>b.addEventListener("click",()=>{manageClassRecordDate=b.dataset.loadClassRecord;render();}));
  document.querySelectorAll("[data-save-class]").forEach(b=>b.addEventListener("click",saveClassFromForm));
  document.querySelectorAll("[data-archive-class]").forEach(b=>b.addEventListener("click",()=>{const x=scheduleData.find(c=>c.id===editingClassId);if(x){x.status="Archived";x.archivedAt=new Date().toISOString();saveSchedule();render();}}));
  document.querySelectorAll("[data-delete-class]").forEach(b=>b.addEventListener("click",()=>{const x=scheduleData.find(c=>c.id===editingClassId);if(x){x.status="Deleted";x.deletedAt=new Date().toISOString();editingClassId=null;saveSchedule();render();}}));
  document.querySelectorAll("[data-restore-sticker]").forEach(b=>b.addEventListener("click",()=>{const x=stickersData.find(s=>s.id===b.dataset.restoreSticker);if(x){x.deletedAt="";saveStickers();render();}}));
  document.querySelectorAll("[data-purge-sticker]").forEach(b=>b.addEventListener("click",()=>{if(!confirm("确定彻底删除这条话术吗？"))return;stickersData=stickersData.filter(s=>s.id!==b.dataset.purgeSticker);saveStickers();render();}));
  document.querySelectorAll("[data-restore-class]").forEach(b=>b.addEventListener("click",()=>{const x=scheduleData.find(c=>c.id===b.dataset.restoreClass);if(x){x.status="Active";x.deletedAt="";saveSchedule();render();}}));
  document.querySelectorAll("[data-purge-class]").forEach(b=>b.addEventListener("click",()=>{if(!confirm("确定彻底删除这节课吗？"))return;scheduleData=scheduleData.filter(c=>c.id!==b.dataset.purgeClass);saveSchedule();render();}));
  document.querySelectorAll("[data-export-all]").forEach(b=>b.addEventListener("click",()=>{byId("backupText").value=JSON.stringify({stickers:stickersData,classes:scheduleData,stickerCategories,courseCategories},null,2);showToast("已导出");}));
  document.querySelectorAll("[data-import-all]").forEach(b=>b.addEventListener("click",importAll));
}

/* Final usability pass: compact editing, direct course edits, and cleaner schedule controls. */
function finalTermOptions(){
  return ["上半年","下半年","假期营","1对1"];
}

function finalRepeatOptions(){
  return ["每周一次","一周多次","假期营连续","自定义"];
}

function renderScheduleControls(){
  const viewTabs=tabs([{value:"today",label:"今日"},{value:"week",label:"本周"},{value:"month",label:"月总览"}],scheduleMode,"scheduleMode");
  const weekNav=scheduleMode==="week"?`<div class="week-jump"><button class="tab" data-week-move="-1" type="button">上一周</button><span>${activeWeekLabel()}</span><button class="tab ${finalWeekOffset===0?'active':''}" data-week-reset type="button">本周</button><button class="tab" data-week-move="1" type="button">下一周</button></div>`:"";
  const addBtn=`<button class="tab schedule-add-class" data-schedule-add-class type="button">添加课程</button>`;
  return `<div class="schedule-controls"><div class="schedule-switch">${viewTabs}</div><div class="schedule-tools">${weekNav}${addBtn}</div></div>`;
}

function renderToday(){
  const classes=displayClasses();
  const labels={today:["今日",""],week:["本周",""],month:["月总览",""]};
  // 计算各视图的实际课程节数
  let counterText="";
  if(scheduleMode==="today"){
    const n=classesOnDate(classes,todoDate()).length;
    counterText=n+" 节课";
  }else if(scheduleMode==="week"){
    const start=activeWeekStart();
    let total=0;
    WORKDAYS.forEach((_,i)=>{total+=classesOnDate(classes,addDays(start,i)).length;});
    counterText="本周 "+total+" 节";
  }else{
    const base=addMonths(new Date(),calendarMonthOffset);
    const first=new Date(base.getFullYear(),base.getMonth(),1);
    const last=new Date(base.getFullYear(),base.getMonth()+1,0);
    let total=0;
    for(let d=new Date(first);d<=last;d=addDays(d,1))total+=classesOnDate(classes,d).length;
    counterText="本月 "+total+" 节";
  }
  setHead(labels[scheduleMode][0],labels[scheduleMode][1],counterText);
  byId("tabs").innerHTML=renderScheduleControls();
  if(scheduleMode==="today")byId("content").innerHTML=renderTodayDesk(classes);
  if(scheduleMode==="week")byId("content").innerHTML=renderWeekCards(classes);
  if(scheduleMode==="month")byId("content").innerHTML=renderMonthCalendar(classes);
  bindTodayEvents();
  bindScheduleCards(classes);
}

function bindTodayEvents(){
  document.querySelectorAll("[data-scheduleMode]").forEach(b=>b.addEventListener("click",()=>{scheduleMode=b.dataset.schedulemode;render();}));
  document.querySelectorAll("[data-week-move]").forEach(b=>b.addEventListener("click",()=>{finalWeekOffset+=Number(b.dataset.weekMove)||0;render();}));
  document.querySelectorAll("[data-week-reset]").forEach(b=>b.addEventListener("click",()=>{finalWeekOffset=0;render();}));
  document.querySelectorAll("[data-month-move]").forEach(b=>b.addEventListener("click",()=>{calendarMonthOffset+=Number(b.dataset.monthMove);monthSelectedDate="";render();}));
  document.querySelectorAll("[data-month-current]").forEach(b=>b.addEventListener("click",()=>{calendarMonthOffset=0;monthSelectedDate=dateKey(new Date());render();}));
  document.querySelectorAll("[data-month-day]").forEach(b=>b.addEventListener("click",()=>{monthSelectedDate=b.dataset.monthDay;render();}));
  document.querySelectorAll("[data-todo-date]").forEach(b=>b.addEventListener("click",()=>{todoDateOffset+=Number(b.dataset.todoDate);render();}));
  document.querySelectorAll("[data-todo-date-set]").forEach(el=>el.addEventListener("change",()=>{const picked=parseLocalDate(el.value);if(picked)todoDateOffset=daysBetween(picked,new Date());render();}));
  document.querySelectorAll("[data-add-todo]").forEach(b=>b.addEventListener("click",addTodoFromInput));
  document.querySelectorAll("[data-toggle-todo]").forEach(b=>b.addEventListener("click",()=>toggleTodo(b.dataset.toggleTodo)));
  document.querySelectorAll("[data-delete-todo]").forEach(b=>b.addEventListener("click",()=>deleteTodo(b.dataset.deleteTodo)));
  document.querySelectorAll("[data-schedule-add-class]").forEach(b=>b.addEventListener("click",()=>{view="manage";manageMode="classes";editingClassId=null;manageClassSearch="";render();}));
}

function stickerForm(x){
  x=x||{scene:"before",audience:"group",title:"",content:"",note:""};
  return `<h3>${x.id?'编辑话术':'新增话术'}</h3><div class="sticker-editor-grid final-sticker-editor"><div class="form-grid"><label class="field">标题<input id="stickerTitle" value="${safeAttr(x.title)}"></label><label class="field">场景<select id="stickerScene">${SCENES.map(v=>`<option value="${v}" ${x.scene===v?'selected':''}>${SCENE_LABELS[v]}</option>`).join("")}</select></label><label class="field">发给<select id="stickerAudience">${AUDIENCES.map(v=>`<option value="${v}" ${x.audience===v?'selected':''}>${AUDIENCE_LABELS[v]}</option>`).join("")}</select></label><label class="field full sticker-note-field">备注<textarea id="stickerNote" placeholder="可写用途、班级、注意点；不写就空白">${esc(x.note||"")}</textarea></label><label class="field full">内容<textarea id="stickerContent">${esc(x.content||"")}</textarea></label></div><aside class="live-preview"><span>预览</span><b>${esc(x.title||"新话术标题")}</b>${x.note?`<small class="preview-note">${esc(x.note)}</small>`:""}<p>${esc(x.content||"这里会显示话术内容，保存后会变成话术卡片。")}</p></aside></div><div class="form-actions"><button class="btn primary" data-save-sticker>保存</button>${x.id?'<button class="btn ghost" data-archive-sticker>归档</button><button class="btn danger" data-delete-sticker>删除</button>':''}</div>`;
}

function renderClassManage(){
  const source=scheduleData.filter(x=>x.status!=="Deleted");
  const list=filterClassesForManage(source);
  const current=scheduleData.find(x=>x.id===editingClassId)||null;
  byId("content").innerHTML=`<div class="manage-layout class-manage compact-manage upgraded-class-manage final-class-manage"><section class="list-panel"><div class="panel-head"><h3>找课程</h3><button class="btn primary compact-add" data-new-class>添加</button></div><input class="search-input" id="manageClassSearch" value="${safeAttr(manageClassSearch)}" placeholder="搜索课程、老师、学生、Zoom">${classTypeFilterBar()}<div class="item-list card-list">${list.map(x=>`<button class="list-item course-list-item ${x.id===editingClassId?'active':''}" data-edit-class="${safeAttr(x.id)}"><b>${esc(x.weekday)} ${esc(formatTimeCN(x.time)||"未定")} · ${esc(x.className)}</b><span>${esc(courseTypeLabel(x))} · ${esc(x.teacher||"未填老师")} · ${esc(classTermLabel(x))}</span></button>`).join("")||'<p class="empty">这里没有找到课程。</p>'}</div></section><section class="edit-panel preview-edit">${classForm(current)}</section></div>`;
}

function classForm(x){
  x=x||{weekday:"周一",time:"",teacher:"",courseType:"LR",className:"",status:"Active",term:"上半年",repeatMode:"每周一次",students:[],notes:[],zoomLabel:"",lesson:"",topic:"",totalLessons:"20",startDate:"",report:""};
  const code=courseCode(x)||x.courseType||"LR";
  const term=x.term||"上半年";
  const repeatMode=x.repeatMode||"每周一次";
  const selectedDate=manageClassRecordDate||latestClassRecordDate(x);
  const recordText=classRecordTextForDate(x,selectedDate)||lessonNotebookText(x);
  return `<h3>${x.id?'编辑课程':'新增课程'}</h3><p class="form-hint">先填固定课程资料；日期、停课日和总课数会帮你算第几课。</p><div class="course-editor-clean final-course-editor"><div class="form-section full course-card-section"><b>课程卡</b><div class="form-grid inner"><label class="field">星期<select id="classWeekday">${WORKDAYS.map(v=>`<option value="${v}" ${x.weekday===v?'selected':''}>${v}</option>`).join("")}</select></label><label class="field">时间<input id="classTime" type="time" value="${safeAttr(x.time)}"></label><label class="field">课程名<input id="className" value="${safeAttr(x.className)}" placeholder="如：英文精读 HP3"></label><label class="field">老师<input id="classTeacher" value="${safeAttr(x.teacher)}"></label><label class="field">分类<select id="classCourseType">${CLASS_TYPE_FILTERS.map(t=>`<option value="${t.value}" ${code===t.value?'selected':''}>${t.value}</option>`).join("")}</select></label><label class="field">学期<select id="classTerm">${finalTermOptions().map(v=>`<option value="${v}" ${term===v?'selected':''}>${v}</option>`).join("")}</select></label><label class="field">上课规律<select id="classRepeatMode">${finalRepeatOptions().map(v=>`<option value="${v}" ${repeatMode===v?'selected':''}>${v}</option>`).join("")}</select></label></div></div><div class="form-section progress-section"><b>进度</b><div class="form-grid inner two"><label class="field">开课日期<input id="classStartDate" type="date" value="${safeAttr(x.startDate)}"></label><label class="field">总课数<input id="classTotalLessons" value="${safeAttr(x.totalLessons||"20")}" placeholder="20 / 21 / 19"></label><label class="field full">停课日期<textarea id="classSkippedDates" placeholder="一行一个日期，如 2026-06-10">${esc(skippedDates(x).join('\n'))}</textarea></label><label class="field full">本周主题<input id="classTopic" value="${safeAttr(x.topic)}" placeholder="只要主题不变，就不用每周重写"></label></div></div><div class="form-section zoom-compact-section final-zoom-section"><b>Zoom 账号</b><label class="field"><input id="classZoomLabel" value="${safeAttr(x.zoomLabel)}" placeholder="zoom1 / camp / siyanci"></label></div><label class="field full students-section">学生<textarea id="classStudents" placeholder="每行一个学生；可写：姓名 | 备注">${esc((x.students||[]).map(s=>s.name+(s.note?' | '+s.note:'')).join('\n'))}</textarea></label><div class="form-section full notebook-editor-section"><b>当天记录本</b><div class="record-date-row"><label class="field">记录日期<input id="classRecordDate" type="date" value="${safeAttr(selectedDate)}"></label><span>每次上课后的资料、作业、课堂记录写这里，保存后会留在历史里。</span></div><label class="field full">记录内容<textarea id="classReport" placeholder="例如：今天讲了什么、作业是什么、孩子表现、下次提醒">${esc(recordText)}</textarea></label>${classRecordHistoryHtml(x,selectedDate)}</div></div><div class="form-actions"><button class="btn primary" data-save-class>保存</button>${x.id?'<button class="btn ghost" data-archive-class>归档</button><button class="btn danger" data-delete-class>删除</button>':''}</div>`;
}

function saveClassFromForm(){
  const existing=scheduleData.find(x=>x.id===editingClassId);
  const report=formVal("classReport").trim();
  const recordDate=formVal("classRecordDate")||manageClassRecordDate||dateKey(new Date());
  const records=existing&&Array.isArray(existing.classRecords)?existing.classRecords.slice():[];
  const recordIndex=records.findIndex(r=>r.date===recordDate);
  if(report || recordIndex>=0){
    const nextRecord={date:recordDate,materials:report,notes:report,updatedAt:new Date().toISOString()};
    if(recordIndex>=0) records[recordIndex]={...records[recordIndex],...nextRecord};
    else records.push(nextRecord);
  }
  const item=normalizeClassItem({
    ...(existing||{}),
    id:editingClassId||uid("class"),
    weekday:formVal("classWeekday")||"周一",
    time:formVal("classTime"),
    className:formVal("className")||"未命名课程",
    teacher:formVal("classTeacher"),
    courseType:formVal("classCourseType")||"LR",
    status:existing&&existing.status==="Archived"?"Archived":"Active",
    students:parseStudents(formVal("classStudents")),
    zoomLabel:formVal("classZoomLabel"),
    lesson:existing?existing.lesson:"",
    topic:formVal("classTopic"),
    totalLessons:formVal("classTotalLessons")||"20",
    startDate:formVal("classStartDate"),
    homework:report,
    report,
    notes:existing?existing.notes:[]
  });
  item.term=formVal("classTerm")||"上半年";
  item.repeatMode=formVal("classRepeatMode")||"每周一次";
  item.zoomLink=existing?existing.zoomLink||"":"";
  item.zoomId=existing?existing.zoomId||"":"";
  item.zoomPassword=existing?existing.zoomPassword||"":"";
  item.skippedDates=formVal("classSkippedDates").split(/\n+/).map(x=>x.trim()).filter(Boolean);
  item.classRecords=records;
  if(report){
    if(item.notes[0]){item.notes[0].text=report;item.notes[0].updatedAt=new Date().toISOString();}
    else item.notes.unshift({id:uid("note"),text:report,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
  const idx=scheduleData.findIndex(x=>x.id===editingClassId);
  if(idx>=0) scheduleData[idx]={...scheduleData[idx],...item};
  else scheduleData.push(item);
  editingClassId=item.id;
  manageClassRecordDate=recordDate;
  saveSchedule();
  showToast("已保存课程");
  render();
}

function classDetailText(item){
  return `老师：${item.teacher||"未填"}\n学生：${item.students.map(s=>s.name).join("、")||"暂无"}\n课程：${item.courseType||"未填"}\n进度：${lessonLabel(item)}\n主题：${item.topic||"未填"}\n学期：${classTermLabel(item)}\nZoom账号：${zoomName(item)||"未填"}\n\n课程笔记：${lessonNotebookText(item)||"未填"}`;
}

function classDetailHtml(item){
  return `<div class="detail-section"><h4>上课信息</h4><div class="detail-grid detail-grid-colored final-detail-grid">${fieldCard("老师",item.teacher)}${fieldCard("学生",item.students.map(s=>s.name).join("、")||"暂无")}${fieldCard("课程",item.courseType)}${fieldCard("进度",lessonLabel(item))}${fieldCard("主题",item.topic)}${fieldCard("学期",classTermLabel(item))}${fieldCard("Zoom 账号",zoomName(item))}</div></div><div class="detail-section daily-record-section notebook-section final-notebook-section">${fieldCard("课程笔记",lessonNotebookText(item),true)}</div>`;
}

function openClassDetailModal(item){
  const isDemo=String(item.id||"").startsWith("demo-");
  byId("detailTags").innerHTML=`<span class="scene-tag detail-day-tag">${esc(item.weekday)}</span><span class="audience-tag detail-status-tag">${esc(classTermLabel(item))}</span><span class="audience-tag detail-time-tag">${esc(countdownText(item))}</span>`;
  byId("detailTitle").textContent=(item.time?formatTimeCN(item.time)+" · ":"")+item.className;
  byId("detailContent").innerHTML=classDetailHtml(item);
  byId("detailOpenZoom").hidden=!item.zoomLink;
  byId("detailEdit").hidden=isDemo;
  byId("detailEdit").textContent="直接编辑";
  byId("detailEdit").onclick=isDemo?null:()=>renderClassInlineEditor(item);
  byId("detailCopy").textContent="复制课程详情";
  byId("detailCopy").onclick=()=>copyText(classDetailText(item));
  byId("detailModal").classList.add("show");
  byId("detailModal").setAttribute("aria-hidden","false");
}

function renderClassInlineEditor(item){
  byId("detailTags").innerHTML=`<span class="scene-tag detail-day-tag">${esc(item.weekday)}</span><span class="audience-tag detail-status-tag">直接编辑</span>`;
  byId("detailTitle").textContent="编辑 · "+item.className;
  const code=courseCode(item)||item.courseType||"LR";
  const date=classRecordDate(item);
  byId("detailContent").innerHTML=`<div class="modal-edit-card compact-inline-class"><div class="form-grid"><label class="field">星期<select id="modalWeekday">${WORKDAYS.map(v=>`<option value="${v}" ${item.weekday===v?'selected':''}>${v}</option>`).join("")}</select></label><label class="field">时间<input id="modalTime" type="time" value="${safeAttr(item.time)}"></label><label class="field">课程名<input id="modalName" value="${safeAttr(item.className)}"></label><label class="field">老师<input id="modalTeacher" value="${safeAttr(item.teacher)}"></label><label class="field">分类<select id="modalType">${CLASS_TYPE_FILTERS.map(t=>`<option value="${t.value}" ${code===t.value?'selected':''}>${t.value}</option>`).join("")}</select></label><label class="field">学期<select id="modalTerm">${finalTermOptions().map(v=>`<option value="${v}" ${(item.term||"上半年")===v?'selected':''}>${v}</option>`).join("")}</select></label><label class="field">开课日期<input id="modalStartDate" type="date" value="${safeAttr(item.startDate)}"></label><label class="field">总课数<input id="modalTotalLessons" value="${safeAttr(item.totalLessons||"20")}"></label><label class="field">本周主题<input id="modalTopic" value="${safeAttr(item.topic)}" placeholder="主题不变就不用改"></label><label class="field">Zoom 账号<input id="modalZoomLabel" value="${safeAttr(item.zoomLabel)}"></label><label class="field full">停课日期<textarea id="modalSkippedDates">${esc(skippedDates(item).join('\n'))}</textarea></label><label class="field full">学生<textarea id="modalStudents">${esc((item.students||[]).map(s=>s.name+(s.note?' | '+s.note:'')).join('\n'))}</textarea></label><label class="field full">课程笔记<textarea id="modalRecordNotes">${esc(classRecordTextForDate(item,date)||lessonNotebookText(item))}</textarea></label></div></div>`;
  byId("detailOpenZoom").hidden=true;
  byId("detailEdit").hidden=false;
  byId("detailEdit").textContent="取消";
  byId("detailEdit").onclick=()=>openClassDetailModal(item);
  byId("detailCopy").textContent="保存修改";
  byId("detailCopy").onclick=()=>saveInlineClass(item.id,item);
}

function saveInlineClass(id,sourceItem){
  const existing=scheduleData.find(x=>x.id===id);
  if(!existing) return;
  const date=classRecordDate(sourceItem||existing);
  const notes=formVal("modalRecordNotes").trim();
  const records=Array.isArray(existing.classRecords)?existing.classRecords.slice():[];
  const recordIndex=records.findIndex(r=>r.date===date);
  if(notes || recordIndex>=0){
    const nextRecord={date,materials:notes,notes,updatedAt:new Date().toISOString()};
    if(recordIndex>=0) records[recordIndex]={...records[recordIndex],...nextRecord};
    else records.push(nextRecord);
  }
  const item=normalizeClassItem({
    ...existing,
    weekday:formVal("modalWeekday")||existing.weekday,
    time:formVal("modalTime"),
    className:formVal("modalName")||"未命名课程",
    teacher:formVal("modalTeacher"),
    courseType:formVal("modalType")||"LR",
    status:existing.status==="Archived"?"Archived":"Active",
    startDate:formVal("modalStartDate"),
    totalLessons:formVal("modalTotalLessons")||"20",
    topic:formVal("modalTopic"),
    zoomLabel:formVal("modalZoomLabel"),
    students:parseStudents(formVal("modalStudents")),
    homework:notes,
    report:notes,
    notes:existing.notes
  });
  item.term=formVal("modalTerm")||"上半年";
  item.repeatMode=existing.repeatMode||"每周一次";
  item.zoomLink=existing.zoomLink||"";
  item.zoomId=existing.zoomId||"";
  item.zoomPassword=existing.zoomPassword||"";
  item.skippedDates=formVal("modalSkippedDates").split(/\n+/).map(x=>x.trim()).filter(Boolean);
  item.classRecords=records;
  if(notes){
    if(item.notes[0]){item.notes[0].text=notes;item.notes[0].updatedAt=new Date().toISOString();}
    else item.notes.unshift({id:uid("note"),text:notes,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
  const idx=scheduleData.findIndex(x=>x.id===id);
  scheduleData[idx]={...scheduleData[idx],...item};
  saveSchedule();
  showToast("已保存修改");
  render();
  const refreshed=classesOnDate([scheduleData[idx]],parseLocalDate(date)||new Date())[0]||scheduleData[idx];
  openClassDetailModal(refreshed);
}

function finalRepeatOptions(){
  return ["每周一次","一周多次","假期营连续"];
}

function classForm(x){
  x=x||{weekday:"周一",time:"",teacher:"",courseType:"LR",className:"",status:"Active",term:"上半年",repeatMode:"每周一次",students:[],notes:[],zoomLabel:"",lesson:"",topic:"",totalLessons:"20",startDate:"",report:""};
  const code=courseCode(x)||x.courseType||"LR";
  const term=x.term||"上半年";
  const repeatMode=x.repeatMode||"每周一次";
  const selectedDate=manageClassRecordDate||latestClassRecordDate(x);
  const recordText=classRecordTextForDate(x,selectedDate)||lessonNotebookText(x);
  return `<h3>${x.id?'编辑课程':'新增课程'}</h3>
  <p class="form-hint">先固定课程资料；开课日期、停课日和总课数会帮你算第几课。</p>
  <div class="course-editor-clean final-course-editor cleaner-course-editor">
    <div class="form-section full course-card-section">
      <b>课程卡</b>
      <div class="form-grid inner compact-course-fields">
        <label class="field">星期<select id="classWeekday">${WORKDAYS.map(v=>`<option value="${v}" ${x.weekday===v?'selected':''}>${v}</option>`).join("")}</select></label>
        <label class="field">时间<input id="classTime" type="time" value="${safeAttr(x.time)}"></label>
        <label class="field wide">课程名<input id="className" value="${safeAttr(x.className)}" placeholder="如：英文精读 HP3"></label>
        <label class="field">老师<input id="classTeacher" value="${safeAttr(x.teacher)}"></label>
        <label class="field">分类<select id="classCourseType">${CLASS_TYPE_FILTERS.map(t=>`<option value="${t.value}" ${code===t.value?'selected':''}>${t.value}</option>`).join("")}</select></label>
        <label class="field">学期<select id="classTerm">${finalTermOptions().map(v=>`<option value="${v}" ${term===v?'selected':''}>${v}</option>`).join("")}</select></label>
        <label class="field repeat-field">排课方式<select id="classRepeatMode">${finalRepeatOptions().map(v=>`<option value="${v}" ${repeatMode===v?'selected':''}>${v}</option>`).join("")}</select></label>
      </div>
      <p class="repeat-help">每周一次：按固定星期自动算进度；一周多次/假期营连续：先保存规则，后续可扩展成批量排课。</p>
    </div>

    <div class="form-section full progress-section">
      <b>进度</b>
      <div class="form-grid inner progress-grid-clean">
        <label class="field">开课日期<input id="classStartDate" type="date" value="${safeAttr(x.startDate)}"></label>
        <label class="field">总课数<input id="classTotalLessons" value="${safeAttr(x.totalLessons||"20")}" placeholder="20 / 21 / 19"></label>
        <label class="field full">停课日期<textarea id="classSkippedDates" placeholder="一行一个日期，如 2026-06-10">${esc(skippedDates(x).join('\n'))}</textarea></label>
        <label class="field full">本周主题<input id="classTopic" value="${safeAttr(x.topic)}" placeholder="主题不变就不用改；后续修改再更新"></label>
      </div>
    </div>

    <div class="form-section full people-zoom-section">
      <b>学生 & Zoom</b>
      <div class="form-grid inner people-zoom-grid">
        <label class="field students-mini">学生<textarea id="classStudents" placeholder="每行一个学生；可写：姓名 | 备注">${esc((x.students||[]).map(s=>s.name+(s.note?' | '+s.note:'')).join('\n'))}</textarea></label>
        <label class="field zoom-mini">Zoom 账号<input id="classZoomLabel" value="${safeAttr(x.zoomLabel)}" placeholder="zoom1 / camp / siyanci"></label>
      </div>
    </div>

    <div class="form-section full notebook-editor-section">
      <b>当天记录本</b>
      <div class="record-date-row"><label class="field">记录日期<input id="classRecordDate" type="date" value="${safeAttr(selectedDate)}"></label><span>每次上课后的资料、作业、课堂记录写这里，保存后会留在历史里。</span></div>
      <label class="field full">记录内容<textarea id="classReport" placeholder="例如：今天讲了什么、作业是什么、孩子表现、下次提醒">${esc(recordText)}</textarea></label>
      ${classRecordHistoryHtml(x,selectedDate)}
    </div>
  </div>
  <div class="form-actions"><button class="btn primary" data-save-class>保存</button>${x.id?'<button class="btn ghost" data-archive-class>归档</button><button class="btn danger" data-delete-class>删除</button>':''}</div>`;
}

function finalRepeatOptions(){
  return [
    {value:"weekly",label:"每周固定"},
    {value:"multi",label:"一周多次"},
    {value:"dates",label:"假期营/指定日期"}
  ];
}

function repeatModeValue(raw){
  if(raw==="multi"||raw==="一周多次") return "multi";
  if(raw==="dates"||raw==="假期营连续"||raw==="假期营/指定日期"||raw==="自定义") return "dates";
  return "weekly";
}

function repeatDaysFor(x){
  const days=Array.isArray(x&&x.repeatDays)?x.repeatDays.filter(Boolean):[];
  return days.length?days:[(x&&x.weekday)||"周一"];
}

function repeatDatesFor(x){
  const raw=(x&&x.repeatDates)||[];
  if(Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw||"").split(/[\n,，、]+/).map(s=>s.trim()).filter(Boolean);
}

function repeatDayPicker(selected){
  const picked=new Set(selected);
  return `<div class="repeat-day-picker">${WORKDAYS.map(day=>`<label class="day-chip ${picked.has(day)?'checked':''}"><input type="checkbox" data-repeat-day value="${day}" ${picked.has(day)?'checked':''}>${day.replace("周","")}</label>`).join("")}</div>`;
}

function repeatLabel(mode){
  const found=finalRepeatOptions().find(x=>x.value===mode);
  return found?found.label:"每周固定";
}

function occursByRule(cls,d){
  const key=dateKey(d);
  if(skippedDates(cls).includes(key)) return false;
  const start=parseLocalDate(cls.startDate);
  if(start&&d<start) return false;
  const extraDates=repeatDatesFor(cls);
  const mode=repeatModeValue(cls.repeatMode);
  if(mode==="dates"){
    if(extraDates.length) return extraDates.includes(key);
  } else if(extraDates.includes(key)){
    // 拖拽改日期：repeatDates 里的日期强制显示（不受 weekday 限制）
    return true;
  }
  return repeatDaysFor(cls).includes(WEEKDAYS[d.getDay()]);
}

function occurrenceInfo(cls,d){
  const total=Number(cls.totalLessons)||20;
  if(!occursByRule(cls,d)) return {show:false,lesson:""};
  // 没有开课日期 → 只显示进度标签，不做课数限制
  if(!cls.startDate) return {show:true,lesson:cls.lesson||"进度未填"};
  const start=parseLocalDate(cls.startDate);
  if(!start||d<start) return {show:false,lesson:""};
  const key=dateKey(d);
  const mode=repeatModeValue(cls.repeatMode);
  let lessonNo=0;
  if(mode==="dates"&&repeatDatesFor(cls).length){
    const dates=repeatDatesFor(cls).filter(x=>!skippedDates(cls).includes(x)).sort();
    lessonNo=dates.filter(x=>x<=key).length;
  }else{
    // 逐周计数（不逐天，性能更好）
    for(let day=new Date(start);day<=d;day=addDays(day,7)){
      if(occursByRule(cls,day)) lessonNo++;
    }
  }
  if(lessonNo<1) return {show:true,lesson:"第 1/"+total+" 课"};
  if(lessonNo>total) return {show:false,lesson:""}; // 超过总课数 → 不再显示
  return {show:true,lesson:"第 "+lessonNo+"/"+total+" 课"};
}

function classesOnDate(classes,d){
  return classes
    .filter(x=>occursByRule(x,d))
    .map(x=>({...x,_occurrenceDate:dateKey(d),_autoLesson:occurrenceInfo(x,d).lesson,_showOnDate:occurrenceInfo(x,d).show}))
    .filter(x=>x._showOnDate)
    .sort((a,b)=>timeMinutes(a.time)-timeMinutes(b.time));
}

function classForm(x){
  x=x||{weekday:"周一",time:"",teacher:"",courseType:"LR",className:"",status:"Active",term:"上半年",repeatMode:"weekly",students:[],notes:[],zoomLabel:"",lesson:"",topic:"",totalLessons:"20",startDate:"",report:""};
  const code=courseCode(x)||x.courseType||"LR";
  const term=x.term||"上半年";
  const repeatMode=repeatModeValue(x.repeatMode);
  const selectedDays=repeatDaysFor(x);
  const selectedDate=manageClassRecordDate||latestClassRecordDate(x);
  const recordText=classRecordTextForDate(x,selectedDate)||lessonNotebookText(x);
  return `<h3>${x.id?'编辑课程':'新增课程'}</h3>
  <p class="form-hint">像 Zoom 排课一样：先定课程资料，再勾上课日期；停课日会自动跳过。</p>
  <div class="course-editor-clean final-course-editor smarter-course-editor">
    <div class="form-section full course-card-section course-basic-section">
      <b>课程资料</b>
      <div class="form-grid inner compact-course-fields">
        <label class="field">星期<select id="classWeekday">${WORKDAYS.map(v=>`<option value="${v}" ${x.weekday===v?'selected':''}>${v}</option>`).join("")}</select></label>
        <label class="field">时间<input id="classTime" type="time" value="${safeAttr(x.time)}"></label>
        <label class="field wide">课程名<input id="className" value="${safeAttr(x.className)}" placeholder="如：英文精读 HP3"></label>
        <label class="field">老师<input id="classTeacher" value="${safeAttr(x.teacher)}"></label>
        <label class="field">分类<select id="classCourseType">${CLASS_TYPE_FILTERS.map(t=>`<option value="${t.value}" ${code===t.value?'selected':''}>${t.value}</option>`).join("")}</select></label>
        <label class="field">学期<select id="classTerm">${finalTermOptions().map(v=>`<option value="${v}" ${term===v?'selected':''}>${v}</option>`).join("")}</select></label>
      </div>
    </div>

    <div class="form-section full people-zoom-section inline-people-zoom">
      <b>学生和 Zoom</b>
      <div class="form-grid inner people-zoom-grid">
        <label class="field students-mini">学生<textarea id="classStudents" placeholder="每行一个学生；可写：姓名 | 备注">${esc((x.students||[]).map(s=>s.name+(s.note?' | '+s.note:'')).join('\n'))}</textarea></label>
        <label class="field zoom-mini">Zoom 账号<input id="classZoomLabel" value="${safeAttr(x.zoomLabel)}" placeholder="zoom1 / camp / siyanci"></label>
      </div>
    </div>

    <div class="form-section full schedule-rule-section">
      <b>排课与进度</b>
      <div class="rule-row">
        <label class="field">排课方式<select id="classRepeatMode">${finalRepeatOptions().map(v=>`<option value="${v.value}" ${repeatMode===v.value?'selected':''}>${v.label}</option>`).join("")}</select></label>
        <label class="field">开课日期<input id="classStartDate" type="date" value="${safeAttr(x.startDate)}"></label>
        <label class="field small">总课数<input id="classTotalLessons" value="${safeAttr(x.totalLessons||"20")}" placeholder="20"></label>
      </div>
      <div class="rule-days"><span>上课星期</span>${repeatDayPicker(selectedDays)}</div>
      <div class="form-grid inner progress-grid-clean rule-textareas">
        <label class="field full">假期营/指定日期<textarea id="classRepeatDates" placeholder="一行一个日期，如 2026-07-01">${esc(repeatDatesFor(x).join('\n'))}</textarea></label>
        <label class="field full">停课日期<textarea id="classSkippedDates" placeholder="一行一个日期，如 2026-06-10">${esc(skippedDates(x).join('\n'))}</textarea></label>
        <label class="field full">本周主题<input id="classTopic" value="${safeAttr(x.topic)}" placeholder="主题不变就不用改；需要时再更新"></label>
      </div>
      <p class="repeat-help">每周固定：按勾选星期自动算进度；一周多次：可勾多个星期；假期营/不规则课：直接填具体日期。</p>
    </div>

    <div class="form-section full notebook-editor-section">
      <b>当天记录本</b>
      <div class="record-date-row"><label class="field">记录日期<input id="classRecordDate" type="date" value="${safeAttr(selectedDate)}"></label><span>每次上课后的资料、作业、课堂记录写这里，保存后会留在历史里。</span></div>
      <label class="field full">记录内容<textarea id="classReport" placeholder="例如：今天讲了什么、作业是什么、孩子表现、下次提醒">${esc(recordText)}</textarea></label>
      ${classRecordHistoryHtml(x,selectedDate)}
    </div>
  </div>
  <div class="form-actions"><button class="btn primary" data-save-class>保存</button>${x.id?'<button class="btn ghost" data-archive-class>归档</button><button class="btn danger" data-delete-class>删除</button>':''}</div>`;
}

function saveClassFromForm(){
  const existing=scheduleData.find(x=>x.id===editingClassId);
  const report=formVal("classReport").trim();
  const recordDate=formVal("classRecordDate")||manageClassRecordDate||dateKey(new Date());
  const records=existing&&Array.isArray(existing.classRecords)?existing.classRecords.slice():[];
  const recordIndex=records.findIndex(r=>r.date===recordDate);
  if(report || recordIndex>=0){
    const nextRecord={date:recordDate,materials:report,notes:report,updatedAt:new Date().toISOString()};
    if(recordIndex>=0) records[recordIndex]={...records[recordIndex],...nextRecord};
    else records.push(nextRecord);
  }
  const repeatDays=[...document.querySelectorAll("[data-repeat-day]:checked")].map(x=>x.value);
  const item=normalizeClassItem({
    ...(existing||{}),
    id:editingClassId||uid("class"),
    weekday:formVal("classWeekday")||repeatDays[0]||"周一",
    time:formVal("classTime"),
    className:formVal("className")||"未命名课程",
    teacher:formVal("classTeacher"),
    courseType:formVal("classCourseType")||"LR",
    status:existing&&existing.status==="Archived"?"Archived":"Active",
    students:parseStudents(formVal("classStudents")),
    zoomLabel:formVal("classZoomLabel"),
    lesson:existing?existing.lesson:"",
    topic:formVal("classTopic"),
    totalLessons:formVal("classTotalLessons")||"20",
    startDate:formVal("classStartDate"),
    homework:report,
    report,
    notes:existing?existing.notes:[]
  });
  item.term=formVal("classTerm")||"上半年";
  item.repeatMode=repeatModeValue(formVal("classRepeatMode"));
  item.repeatDays=repeatDays.length?repeatDays:[item.weekday];
  item.repeatDates=formVal("classRepeatDates").split(/[\n,，、]+/).map(x=>x.trim()).filter(Boolean);
  item.zoomLink=existing?existing.zoomLink||"":"";
  item.zoomId=existing?existing.zoomId||"":"";
  item.zoomPassword=existing?existing.zoomPassword||"":"";
  item.skippedDates=formVal("classSkippedDates").split(/[\n,，、]+/).map(x=>x.trim()).filter(Boolean);
  item.classRecords=records;
  if(report){
    if(item.notes[0]){item.notes[0].text=report;item.notes[0].updatedAt=new Date().toISOString();}
    else item.notes.unshift({id:uid("note"),text:report,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
  const idx=scheduleData.findIndex(x=>x.id===editingClassId);
  if(idx>=0) scheduleData[idx]={...scheduleData[idx],...item};
  else scheduleData.push(item);
  editingClassId=item.id;
  manageClassRecordDate=recordDate;
  saveSchedule();
  showToast("已保存课程");
  render();
}

function finalRepeatOptions(){
  return [
    {value:"weekly",label:"每周固定",desc:"固定每周同一天上课"},
    {value:"multi",label:"一周多次",desc:"一周里可勾多个上课日"},
    {value:"dates",label:"指定日期",desc:"适合假期营、补课、不规律课程"}
  ];
}

function repeatModeValue(raw){
  if(raw==="multi"||raw==="一周多次") return "multi";
  if(raw==="dates"||raw==="假期营连续"||raw==="假期营/指定日期"||raw==="指定日期"||raw==="自定义") return "dates";
  return "weekly";
}

function repeatModeCards(mode){
  return `<div class="repeat-mode-cards">${finalRepeatOptions().map(item=>`
    <button type="button" class="repeat-mode-card ${mode===item.value?'active':''}" data-repeat-mode="${item.value}">
      <b>${item.label}</b><span>${item.desc}</span>
    </button>`).join("")}</div><input id="classRepeatMode" type="hidden" value="${safeAttr(mode)}">`;
}

function classForm(x){
  x=x||{weekday:"周一",time:"",teacher:"",courseType:"LR",className:"",status:"Active",term:"上半年",repeatMode:"weekly",students:[],notes:[],zoomLabel:"",lesson:"",topic:"",totalLessons:"20",startDate:"",report:""};
  const code=courseCode(x)||x.courseType||"LR";
  const term=x.term||"上半年";
  const repeatMode=repeatModeValue(x.repeatMode);
  const selectedDays=repeatDaysFor(x);
  const selectedDate=manageClassRecordDate||latestClassRecordDate(x);
  const recordText=classRecordTextForDate(x,selectedDate)||lessonNotebookText(x);
  return `<h3>${x.id?'编辑课程':'新增课程'}</h3>
  <p class="form-hint">先固定课程资料；日期、停课日和总课数会帮你自动算第几课。</p>
  <div class="course-editor-clean final-course-editor smarter-course-editor tidy-course-editor">
    <div class="form-section full course-card-section course-basic-section">
      <b>课程资料</b>
      <div class="form-grid inner compact-course-fields">
        <label class="field">星期<select id="classWeekday">${WORKDAYS.map(v=>`<option value="${v}" ${x.weekday===v?'selected':''}>${v}</option>`).join("")}</select></label>
        <label class="field">时间<input id="classTime" type="time" value="${safeAttr(x.time)}"></label>
        <label class="field wide">课程名<input id="className" value="${safeAttr(x.className)}" placeholder="如：英文精读 HP3"></label>
        <label class="field">老师<input id="classTeacher" value="${safeAttr(x.teacher)}"></label>
        <label class="field">分类<select id="classCourseType">${CLASS_TYPE_FILTERS.map(t=>`<option value="${t.value}" ${code===t.value?'selected':''}>${t.value}</option>`).join("")}</select></label>
        <label class="field">学期<select id="classTerm">${finalTermOptions().map(v=>`<option value="${v}" ${term===v?'selected':''}>${v}</option>`).join("")}</select></label>
      </div>
    </div>

    <div class="form-section full people-zoom-section inline-people-zoom">
      <b>学生和 Zoom</b>
      <div class="people-zoom-line">
        <label class="field students-mini">学生<textarea id="classStudents" placeholder="每行一个学生；可写：姓名 | 备注">${esc((x.students||[]).map(s=>s.name+(s.note?' | '+s.note:'')).join('\n'))}</textarea></label>
        <label class="field zoom-mini">Zoom 账号<input id="classZoomLabel" value="${safeAttr(x.zoomLabel)}" placeholder="zoom1 / camp / siyanci"></label>
      </div>
    </div>

    <div class="form-section full schedule-rule-section">
      <b>排课和进度</b>
      ${repeatModeCards(repeatMode)}
      <div class="rule-row">
        <label class="field">开课日期<input id="classStartDate" type="date" value="${safeAttr(x.startDate)}"></label>
        <label class="field small">总课数<input id="classTotalLessons" value="${safeAttr(x.totalLessons||"20")}" placeholder="20"></label>
        <label class="field">本周主题<input id="classTopic" value="${safeAttr(x.topic)}" placeholder="主题不变就不用改"></label>
      </div>
      <div class="rule-days"><span>上课星期</span>${repeatDayPicker(selectedDays)}</div>
      <div class="form-grid inner progress-grid-clean rule-textareas">
        <label class="field full">指定上课日期<textarea id="classRepeatDates" placeholder="假期营或不规律课写这里：一行一个日期，如 2026-07-01">${esc(repeatDatesFor(x).join('\n'))}</textarea></label>
        <label class="field full">停课日期<textarea id="classSkippedDates" placeholder="休息/放假写这里：一行一个日期，如 2026-06-10">${esc(skippedDates(x).join('\n'))}</textarea></label>
      </div>
    </div>

    <div class="form-section full notebook-editor-section">
      <b>当天记录本</b>
      <div class="record-date-row"><label class="field">记录日期<input id="classRecordDate" type="date" value="${safeAttr(selectedDate)}"></label><span>每次课的资料、作业、课堂记录写这里，保存后会留在历史里。</span></div>
      <label class="field full">记录内容<textarea id="classReport" placeholder="例如：今天讲了什么、作业是什么、孩子表现、下次提醒">${esc(recordText)}</textarea></label>
      ${classRecordHistoryHtml(x,selectedDate)}
    </div>
  </div>
  <div class="form-actions"><button class="btn primary" data-save-class>保存</button>${x.id?'<button class="btn ghost" data-archive-class>归档</button><button class="btn danger" data-delete-class>删除</button>':''}</div>`;
}

function saveClassFromForm(){
  const existing=scheduleData.find(x=>x.id===editingClassId);
  const report=formVal("classReport").trim();
  const recordDate=formVal("classRecordDate")||manageClassRecordDate||dateKey(new Date());
  const records=existing&&Array.isArray(existing.classRecords)?existing.classRecords.slice():[];
  const recordIndex=records.findIndex(r=>r.date===recordDate);
  if(report || recordIndex>=0){
    const nextRecord={date:recordDate,materials:report,notes:report,updatedAt:new Date().toISOString()};
    if(recordIndex>=0) records[recordIndex]={...records[recordIndex],...nextRecord};
    else records.push(nextRecord);
  }
  const repeatDays=[...document.querySelectorAll("[data-repeat-day]:checked")].map(x=>x.value);
  const item=normalizeClassItem({
    ...(existing||{}),
    id:editingClassId||uid("class"),
    weekday:formVal("classWeekday")||repeatDays[0]||"周一",
    time:formVal("classTime"),
    className:formVal("className")||"未命名课程",
    teacher:formVal("classTeacher"),
    courseType:formVal("classCourseType")||"LR",
    status:existing&&existing.status==="Archived"?"Archived":"Active",
    students:parseStudents(formVal("classStudents")),
    zoomLabel:formVal("classZoomLabel"),
    lesson:existing?existing.lesson:"",
    topic:formVal("classTopic"),
    totalLessons:formVal("classTotalLessons")||"20",
    startDate:formVal("classStartDate"),
    homework:report,
    report,
    notes:existing?existing.notes:[]
  });
  item.term=formVal("classTerm")||"上半年";
  item.repeatMode=repeatModeValue(formVal("classRepeatMode"));
  item.repeatDays=repeatDays.length?repeatDays:[item.weekday];
  item.repeatDates=formVal("classRepeatDates").split(/[\n,，、\s]+/).map(x=>x.trim()).filter(Boolean);
  item.skippedDates=formVal("classSkippedDates").split(/[\n,，、\s]+/).map(x=>x.trim()).filter(Boolean);
  item.zoomLink="";
  item.zoomId="";
  item.zoomPassword="";
  item.classRecords=records;
  if(report){
    if(item.notes[0]){item.notes[0].text=report;item.notes[0].updatedAt=new Date().toISOString();}
    else item.notes.unshift({id:uid("note"),text:report,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
  const idx=scheduleData.findIndex(x=>x.id===editingClassId);
  if(idx>=0) scheduleData[idx]={...scheduleData[idx],...item};
  else scheduleData.push(item);
  editingClassId=item.id;
  manageClassRecordDate=recordDate;
  saveSchedule();
  showToast("已保存课程");
  render();
}

document.addEventListener("click",e=>{
  const modeBtn=e.target.closest&&e.target.closest("[data-repeat-mode]");
  if(!modeBtn) return;
  const wrap=modeBtn.closest(".repeat-mode-cards");
  wrap&&wrap.querySelectorAll("[data-repeat-mode]").forEach(btn=>btn.classList.toggle("active",btn===modeBtn));
  const hidden=byId("classRepeatMode");
  if(hidden) hidden.value=modeBtn.dataset.repeatMode;
});

document.addEventListener("change",e=>{
  const chip=e.target.closest&&e.target.closest(".day-chip");
  if(chip) chip.classList.toggle("checked",e.target.checked);
});

document.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{view=btn.dataset.view;render();}));
byId("detailClose").addEventListener("click",closeStickerDetail);
byId("detailModal").addEventListener("click",e=>{if(e.target.id==="detailModal")closeStickerDetail();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&byId("detailModal").classList.contains("show"))closeStickerDetail();});
// 启动时检查登录状态：有有效会话就直接进入主界面，免去每次重输密码
sb.auth.getSession().then(async ({data})=>{
  const session=data&&data.session;
  // 未登录时保持登录页（loginOverlay 默认显示，appShell 默认 display:none）
  if(!session||!session.user) return;
  const ok=await enterApp(session.user);
  if(!ok){
    const errEl=document.getElementById('loginError');
    if(errEl) errEl.textContent='已检测到登录状态，但云端数据加载失败，请检查网络后刷新或重新登录';
  }
});

/* ===== REDESIGNED CLASS DETAIL MODAL ===== */

function classDetailHtml(item){
  const date=classRecordDate(item);
  const todayNote=classRecordTextForDate(item,date)||"";
  const history=(Array.isArray(item.classRecords)?item.classRecords:[])
    .filter(r=>r.date&&r.date!==date&&(r.notes||r.materials))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)))
    .slice(0,10);
  return `
  <div class="detail-section">
    <h4>上课信息</h4>
    <div class="detail-grid final-detail-grid">
      ${fieldCard("老师",item.teacher)}
      ${fieldCard("学生",item.students.map(s=>s.name).join("、")||"暂无")}
      ${fieldCard("课程",item.courseType)}
      ${fieldCard("进度",lessonLabel(item))}
      ${fieldCard("主题",item.topic)}
      ${fieldCard("学期",classTermLabel(item))}
      ${fieldCard("Zoom 账号",zoomName(item))}
    </div>
  </div>
  <div class="detail-section detail-note-section">
    <div class="note-section-head">
      <h4>${formatDateShort(date)} 课堂笔记</h4>
      ${history.length?`<button class="btn ghost detail-history-toggle" type="button" id="detailHistoryToggle">历史 (${history.length})</button>`:""}
    </div>
    <textarea id="detailNoteInput" class="detail-note-input" placeholder="今天发生了什么？只属于这一天的记录。">${esc(todayNote)}</textarea>
    <button class="btn primary" id="detailNoteSave" type="button">保存笔记</button>
  </div>
  ${history.length?`<div class="detail-history-section" id="detailHistory" hidden>
    ${history.map(r=>`<div class="history-entry"><span class="history-date">${esc(formatDateShort(r.date))}</span><p>${esc(r.notes||r.materials||"")}</p></div>`).join("")}
  </div>`:""}`;
}

function openClassDetailModal(item){
  const isDemo=String(item.id||"").startsWith("demo-");
  byId("detailTags").innerHTML=`<span class="scene-tag detail-day-tag">${esc(item.weekday)}</span><span class="audience-tag detail-status-tag">${esc(classTermLabel(item))}</span><span class="audience-tag detail-time-tag">${esc(countdownText(item))}</span>`;
  byId("detailTitle").textContent=(item.time?formatTimeCN(item.time)+" · ":"")+item.className;
  byId("detailContent").innerHTML=classDetailHtml(item);
  byId("detailOpenZoom").hidden=!item.zoomLink;
  byId("detailOpenZoom").onclick=()=>{if(item.zoomLink)window.open(item.zoomLink,"_blank");};
  byId("detailEdit").hidden=isDemo;
  byId("detailEdit").textContent="直接编辑";
  byId("detailEdit").onclick=isDemo?null:()=>renderClassInlineEditor(item);
  byId("detailCopy").textContent="复制课程详情";
  byId("detailCopy").onclick=()=>copyText(classDetailText(item));
  byId("detailCopy").hidden=true;
  byId("detailModal").classList.add("show");
  byId("detailModal").setAttribute("aria-hidden","false");
  // Bind note save
  const saveBtn=byId("detailNoteSave");
  if(saveBtn) saveBtn.addEventListener("click",()=>{
    const textarea=byId("detailNoteInput");
    const notes=(textarea&&textarea.value||"").trim();
    const date=classRecordDate(item);
    const existing=scheduleData.find(x=>x.id===item.id);
    if(!existing) return;
    const records=Array.isArray(existing.classRecords)?existing.classRecords.slice():[];
    const idx=records.findIndex(r=>r.date===date);
    const rec={date,notes,materials:notes,updatedAt:new Date().toISOString()};
    if(idx>=0) records[idx]={...records[idx],...rec}; else records.push(rec);
    existing.classRecords=records;
    if(notes){
      if(existing.notes[0]){existing.notes[0].text=notes;existing.notes[0].updatedAt=new Date().toISOString();}
      else existing.notes.unshift({id:uid("note"),text:notes,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    }
    saveSchedule();
    showToast("已保存笔记");
  });
  // Bind history toggle — fixed logic
  const toggleBtn=byId("detailHistoryToggle");
  const historySection=byId("detailHistory");
  if(toggleBtn&&historySection){
    const count=historySection.querySelectorAll(".history-entry").length;
    toggleBtn.addEventListener("click",()=>{
      historySection.hidden=!historySection.hidden;
      toggleBtn.textContent=historySection.hidden?`历史 (${count})`:"收起历史";
    });
  }
}

/* ===== REDESIGNED COMPACT INLINE EDITOR ===== */
function renderClassInlineEditor(item){
  byId("detailTags").innerHTML=`<span class="scene-tag detail-day-tag">${esc(item.weekday)}</span><span class="audience-tag detail-status-tag">编辑中</span>`;
  byId("detailTitle").textContent="编辑 · "+item.className;
  const code=courseCode(item)||item.courseType||"LR";
  byId("detailContent").innerHTML=`<div class="compact-inline-editor"><div class="compact-fields">
    <div class="compact-row">
      <label class="field">星期<select id="modalWeekday">${WORKDAYS.map(v=>`<option value="${v}" ${item.weekday===v?'selected':''}>${v}</option>`).join("")}</select></label>
      <label class="field">时间<input id="modalTime" type="time" value="${safeAttr(item.time)}"></label>
    </div>
    <div class="compact-row">
      <label class="field flex2">课程名<input id="modalName" value="${safeAttr(item.className)}"></label>
      <label class="field">老师<input id="modalTeacher" value="${safeAttr(item.teacher)}"></label>
    </div>
    <div class="compact-row">
      <label class="field">分类<select id="modalType">${CLASS_TYPE_FILTERS.map(t=>`<option value="${t.value}" ${code===t.value?'selected':''}>${t.value}</option>`).join("")}</select></label>
      <label class="field">学期<select id="modalTerm">${finalTermOptions().map(v=>`<option value="${v}" ${(item.term||"上半年")===v?'selected':''}>${v}</option>`).join("")}</select></label>
    </div>
    <div class="compact-row">
      <label class="field">开课日期<input id="modalStartDate" type="date" value="${safeAttr(item.startDate)}"></label>
      <label class="field">总课数<input id="modalTotalLessons" value="${safeAttr(item.totalLessons||"20")}"></label>
      <label class="field flex2">本周主题<input id="modalTopic" value="${safeAttr(item.topic)}" placeholder="主题不变就不用改"></label>
    </div>
    <div class="compact-row">
      <label class="field">Zoom 账号<input id="modalZoomLabel" value="${safeAttr(item.zoomLabel)}" placeholder="zoom1 / camp / siyanci"></label>
      <label class="field flex2">Zoom 链接<input id="modalZoomLink" value="${safeAttr(item.zoomLink)}" placeholder="https://zoom.us/j/..."></label>
    </div>
    <div class="compact-row">
      <label class="field full">学生（每行一个，可写：姓名 | 备注）<textarea id="modalStudents" class="mini-textarea">${esc((item.students||[]).map(s=>s.name+(s.note?' | '+s.note:'')).join('\n'))}</textarea></label>
    </div>
    <div class="compact-row">
      <label class="field full">停课日期（每行一个，如 2026-06-10）<textarea id="modalSkippedDates" class="mini-textarea">${esc(skippedDates(item).join('\n'))}</textarea></label>
    </div>
  </div></div>`;
  byId("detailOpenZoom").hidden=true;
  byId("detailEdit").hidden=false;
  byId("detailEdit").textContent="取消";
  byId("detailEdit").onclick=()=>openClassDetailModal(item);
  byId("detailCopy").textContent="保存修改";
  byId("detailCopy").onclick=()=>saveInlineClass(item.id,item);
}

function saveInlineClass(id,sourceItem){
  const existing=scheduleData.find(x=>x.id===id);
  if(!existing) return;
  const item=normalizeClassItem({
    ...existing,
    weekday:formVal("modalWeekday")||existing.weekday,
    time:formVal("modalTime"),
    className:formVal("modalName")||"未命名课程",
    teacher:formVal("modalTeacher"),
    courseType:formVal("modalType")||"LR",
    status:existing.status==="Archived"?"Archived":"Active",
    startDate:formVal("modalStartDate"),
    totalLessons:formVal("modalTotalLessons")||"20",
    topic:formVal("modalTopic"),
    zoomLabel:formVal("modalZoomLabel"),
    students:parseStudents(formVal("modalStudents")),
    notes:existing.notes
  });
  item.term=formVal("modalTerm")||"上半年";
  item.repeatMode=existing.repeatMode||"weekly";
  item.repeatDays=existing.repeatDays||[item.weekday];
  item.repeatDates=existing.repeatDates||[];
  item.zoomLink=formVal("modalZoomLink")||existing.zoomLink||"";
  item.zoomId=existing.zoomId||"";
  item.zoomPassword=existing.zoomPassword||"";
  item.skippedDates=formVal("modalSkippedDates").split(/[\n,，]+/).map(x=>x.trim()).filter(Boolean);
  item.classRecords=existing.classRecords||[];
  const idx=scheduleData.findIndex(x=>x.id===id);
  scheduleData[idx]={...scheduleData[idx],...item};
  saveSchedule();
  showToast("已保存修改");
  render();
  const date=classRecordDate(sourceItem||existing);
  const refreshed=classesOnDate([scheduleData[idx]],parseLocalDate(date)||new Date())[0]||scheduleData[idx];
  openClassDetailModal(refreshed);
}

/* Fix: openStickerDetail — note as corner badge, no full row */
function openStickerDetail(item){
  const note=(item.note||"").trim();
  byId("detailTags").innerHTML=`<span class="scene-tag">${SCENE_LABELS[item.scene]}</span><span class="audience-tag">${AUDIENCE_LABELS[item.audience]}</span>`;
  byId("detailTitle").textContent=item.title;
  byId("detailContent").innerHTML=`<div class="sticker-fulltext-wrap">${note?`<div class="sticker-note-row"><span class="sticker-note-label">备注</span><span class="sticker-note-corner">${esc(note)}</span></div>`:""}<div class="sticker-fulltext">${esc(item.content)}</div></div>`;
  byId("detailOpenZoom").hidden=true;
  byId("detailEdit").hidden=false;
  byId("detailCopy").hidden=false;
  byId("detailEdit").textContent="编辑话术";
  byId("detailEdit").onclick=()=>openStickerInlineEditor(item);
  byId("detailCopy").textContent="复制这条话术";
  byId("detailCopy").onclick=()=>copyText(item.content);
  byId("detailModal").classList.add("show");
  byId("detailModal").setAttribute("aria-hidden","false");
}

function openStickerInlineEditor(item){
  byId("detailTags").innerHTML=`<span class="scene-tag">${SCENE_LABELS[item.scene]}</span><span class="audience-tag">编辑中</span>`;
  byId("detailTitle").textContent="编辑 · "+item.title;
  byId("detailContent").innerHTML=`<div class="modal-edit-card"><div class="form-grid">
    <label class="field">标题<input id="modalStickerTitle" value="${safeAttr(item.title)}"></label>
    <label class="field">场景<select id="modalStickerScene">${SCENES.map(v=>`<option value="${v}" ${item.scene===v?'selected':''}>${SCENE_LABELS[v]}</option>`).join("")}</select></label>
    <label class="field">发给<select id="modalStickerAudience">${AUDIENCES.map(v=>`<option value="${v}" ${item.audience===v?'selected':''}>${AUDIENCE_LABELS[v]}</option>`).join("")}</select></label>
    <label class="field">备注<input id="modalStickerNote" value="${safeAttr(item.note||"")}"></label>
    <label class="field full">内容<textarea id="modalStickerContent">${esc(item.content||"")}</textarea></label>
  </div></div>`;
  byId("detailOpenZoom").hidden=true;
  byId("detailEdit").hidden=false;
  byId("detailEdit").textContent="取消";
  byId("detailEdit").onclick=()=>openStickerDetail(item);
  byId("detailCopy").textContent="保存话术";
  byId("detailCopy").onclick=()=>{
    const updated=normalizeSticker({...item,
      title:byId("modalStickerTitle").value||item.title,
      scene:byId("modalStickerScene").value,
      audience:byId("modalStickerAudience").value,
      content:byId("modalStickerContent").value,
      note:byId("modalStickerNote").value
    });
    const idx=stickersData.findIndex(x=>x.id===item.id);
    if(idx>=0) stickersData[idx]={...stickersData[idx],...updated};
    else stickersData.push(updated);
    saveStickers();
    showToast("已保存话术");
    openStickerDetail(updated);
    if(view==="stickers") render();
  };
}

/* Fix: recordNotes — only show date-specific notes; don't fall back to old item.report */
function recordNotes(item){
  const rec=classRecord(item);
  return (rec&&(rec.notes||rec.materials))||"";
}

/* ===== ALL CONFIRMED BUG FIXES ===== */

// Fix 1: classDetailHtml — use style="display:none" so hidden attr doesn't fight display:grid CSS
function classDetailHtml(item){
  const date=classRecordDate(item);
  const todayNote=classRecordTextForDate(item,date)||"";
  const history=(Array.isArray(item.classRecords)?item.classRecords:[])
    .filter(r=>r.date&&r.date!==date&&(r.notes||r.materials))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)))
    .slice(0,10);
  return `
  <div class="detail-section">
    <h4>上课信息</h4>
    <div class="detail-grid final-detail-grid">
      ${fieldCard("老师",item.teacher)}
      ${fieldCard("课程",item.courseType)}
      ${fieldCard("进度",lessonLabel(item))}
      ${fieldCard("主题",item.topic)}
      ${fieldCard("学期",classTermLabel(item))}
      ${fieldCard("Zoom 账号",zoomName(item))}
      ${fieldCard("学生",item.students.map(s=>s.name).join("、")||"暂无",true)}
    </div>
  </div>
  <div class="detail-section detail-note-section">
    <div class="note-section-head">
      <h4>${formatDateShort(date)} 课堂笔记</h4>
      ${history.length?`<button class="btn ghost detail-history-toggle" id="detailHistoryToggle" type="button">历史 (${history.length})</button>`:""}
    </div>
    <textarea id="detailNoteInput" class="detail-note-input" placeholder="今天发生了什么？只属于这一天的记录。">${esc(todayNote)}</textarea>
    <button class="btn note-save-btn" id="detailNoteSave" type="button">保存笔记</button>
  </div>
  ${history.length?`<div class="detail-history-section" id="detailHistory" style="display:none">
    ${history.map(r=>`<div class="history-entry"><span class="history-date">${esc(formatDateShort(r.date))}</span><p>${esc(r.notes||r.materials||"")}</p></div>`).join("")}
  </div>`:""}`;
}

// Fix 2: openClassDetailModal — style.display toggle, hide copy button
function openClassDetailModal(item){
  const isDemo=String(item.id||"").startsWith("demo-");
  byId("detailTags").innerHTML=`<span class="scene-tag detail-day-tag">${esc(item.weekday)}</span><span class="audience-tag detail-status-tag">${esc(classTermLabel(item))}</span><span class="audience-tag detail-time-tag">${esc(countdownText(item))}</span>`;
  byId("detailTitle").textContent=(item.time?formatTimeCN(item.time)+" · ":"")+item.className;
  byId("detailContent").innerHTML=classDetailHtml(item);
  byId("detailOpenZoom").hidden=!item.zoomLink;
  byId("detailOpenZoom").onclick=()=>{if(item.zoomLink)window.open(item.zoomLink,"_blank");};
  byId("detailEdit").hidden=isDemo;
  byId("detailEdit").textContent="直接编辑";
  byId("detailEdit").onclick=isDemo?null:()=>renderClassInlineEditor(item);
  byId("detailCopy").hidden=true;
  byId("detailModal").classList.add("show");
  byId("detailModal").setAttribute("aria-hidden","false");
  const saveBtn=byId("detailNoteSave");
  if(saveBtn) saveBtn.addEventListener("click",()=>{
    const textarea=byId("detailNoteInput");
    const notes=(textarea&&textarea.value||"").trim();
    const date=classRecordDate(item);
    const existing=scheduleData.find(x=>x.id===item.id);
    if(!existing) return;
    const records=Array.isArray(existing.classRecords)?existing.classRecords.slice():[];
    const idx=records.findIndex(r=>r.date===date);
    const rec={date,notes,materials:notes,updatedAt:new Date().toISOString()};
    if(idx>=0) records[idx]={...records[idx],...rec}; else records.push(rec);
    existing.classRecords=records;
    saveSchedule();
    showToast("已保存笔记");
  });
  // Fix: use style.display so CSS display:grid doesn't override hidden attribute
  const toggleBtn=byId("detailHistoryToggle");
  const historySection=byId("detailHistory");
  if(toggleBtn&&historySection){
    const count=historySection.querySelectorAll(".history-entry").length;
    toggleBtn.addEventListener("click",()=>{
      const isVisible=historySection.style.display!=="none";
      historySection.style.display=isVisible?"none":"";
      toggleBtn.textContent=isVisible?`历史 (${count})`:"收起历史";
    });
  }
}

// Fix 3: renderTodayCourseCard — remove "Zoom" from fallback text (CSS ::before already adds it)
function renderTodayCourseCard(x,linkedTodos=[]){
  const cd=countdownText(x);
  const zoom=zoomName(x)||"未填 Zoom";
  const isNow=cd==="上课中";
  const isSoon=cd.includes("分钟")||cd.includes("小时");
  const cdClass=isNow?"now":isSoon?"soon":"plain";
  const todoRows=linkedTodos.slice(0,3).map(t=>
    `<span class="tcc-td ${t.done?"done":""}">${esc(t.text)}</span>`
  ).join("");
  const todoSection=linkedTodos.length
    ?`<div class="tcc-todo-strip">${todoRows}${linkedTodos.length>3?`<span class="tcc-td-more">+${linkedTodos.length-3} 条</span>`:""}</div>`
    :"";
  return `<button class="tcc-card ${courseTone(x)} ${cdClass}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button">
    <div class="tcc-row-top">
      <span class="tcc-time">${esc(formatTimeCN(x.time))}</span>
      <span class="tcc-pill ${cdClass}">${esc(cd)}</span>
    </div>
    <b class="tcc-name">${esc(x.className)}</b>
    <span class="tcc-sub">${esc(x.teacher||"未填老师")} · ${x.students.length||0} 人 · ${esc(lessonLabel(x))} · ${esc(zoom)}</span>
    ${todoSection}
  </button>`;
}

// Fix 4: renderStickerCard — inline note chip (no absolute positioning issues)
function renderStickerCard(x){
  const note=(x.note||"").trim();
  const audience=x.scene==="ai"&&x.audience==="ai"?"":`<span class="audience-tag">${AUDIENCE_LABELS[x.audience]}</span>`;
  return `<article class="sticker-card ${x.scene}">
    <div class="note-tape"></div>
    <button class="sticker-open" data-detail-id="${safeAttr(x.id)}" type="button">
      <div class="tag-row"><span class="scene-tag">${SCENE_LABELS[x.scene]}</span>${audience}${note?`<span class="sticker-note-tag">${esc(note)}</span>`:""}</div>
      <b>${esc(x.title)}</b>
      <p>${esc(x.content)}</p>
    </button>
    <button class="copy-badge" data-copy-id="${safeAttr(x.id)}" type="button">复制</button>
  </article>`;
}

/* ============================================================
   REMOVE QUICK PHRASES + CLEAN classDetailHtml
   ============================================================ */
function classDetailHtml(item){
  const date=classRecordDate(item);
  const todayNote=classRecordTextForDate(item,date)||"";
  const history=(Array.isArray(item.classRecords)?item.classRecords:[])
    .filter(r=>r.date&&r.date!==date&&(r.notes||r.materials))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)))
    .slice(0,10);
  return `
  <div class="detail-section">
    <h4>上课信息</h4>
    <div class="detail-grid final-detail-grid">
      ${fieldCard("老师",item.teacher)}
      ${fieldCard("课程",item.courseType)}
      ${fieldCard("进度",lessonLabel(item))}
      ${fieldCard("主题",item.topic)}
      ${fieldCard("学期",classTermLabel(item))}
      ${fieldCard("Zoom",zoomName(item))}
      ${fieldCard("学生",item.students.map(s=>s.name).join("、")||"暂无",true)}
    </div>
  </div>
  <div class="detail-section detail-note-section">
    <div class="note-section-head">
      <h4>${formatDateShort(date)} 课堂笔记</h4>
      ${history.length?`<button class="btn ghost detail-history-toggle" id="detailHistoryToggle" type="button">历史 (${history.length})</button>`:""}
    </div>
    <textarea id="detailNoteInput" class="detail-note-input" placeholder="今天发生了什么？只属于这一天。">${esc(todayNote)}</textarea>
    <button class="btn note-save-btn" id="detailNoteSave" type="button">保存笔记</button>
  </div>
  ${history.length?`<div class="detail-history-section" id="detailHistory" style="display:none">
    ${history.map(r=>`<div class="history-entry"><span class="history-date">${esc(formatDateShort(r.date))}</span><p>${esc(r.notes||r.materials||"")}</p></div>`).join("")}
  </div>`:""}`;
}

/* ============================================================
   FIX: renderStickerCard — adds aud-{audience} class
   ============================================================ */
function renderStickerCard(x){
  const note=(x.note||"").trim();
  const audience=x.scene==="ai"&&x.audience==="ai"?"":`<span class="audience-tag aud-${x.audience}">${AUDIENCE_LABELS[x.audience]}</span>`;
  return `<article class="sticker-card ${x.scene}">
    <div class="note-tape"></div>
    <button class="sticker-open" data-detail-id="${safeAttr(x.id)}" type="button">
      <div class="tag-row"><span class="scene-tag">${SCENE_LABELS[x.scene]}</span>${audience}${note?`<span class="sticker-note-tag">${esc(note)}</span>`:""}</div>
      <b>${esc(x.title)}</b>
      <p>${esc(x.content)}</p>
    </button>
    <button class="copy-badge" data-copy-id="${safeAttr(x.id)}" type="button">复制</button>
  </article>`;
}

/* ============================================================
   FEATURE: 建议1 — Quick phrases auto-filled with course data
   ============================================================ */
function quickPhrasesHtml(item){
  const time=formatTimeCN(item.time)||"上课时间";
  const zoom=zoomName(item)||"Zoom账号";
  const teacher=item.teacher||"老师";
  const phrases=[
    {label:"早安提醒",text:`孩子们早安，今天${time}我们准时上课哦！@所有人`},
    {label:"课前提醒 + Zoom",text:`🌹孩子们，稍后${time}我们准时上课哦！@所有人\n🔗Zoom账号：${zoom}`},
    {label:"告知老师出勤",text:`Teacher ${teacher.replace(/^Teacher\s*/i,"")}, all students are present.`},
    {label:"孩子们到齐",text:`[庆祝]孩子们到齐啦！开始上课了`},
  ];
  return `<div class="quick-phrases-section">
    <h4>快速话术 <span>已自动填入课程信息</span></h4>
    <div class="quick-phrase-list">
      ${phrases.map(p=>`<div class="quick-phrase-item">
        <span class="qp-label">${esc(p.label)}</span>
        <p class="qp-text">${esc(p.text)}</p>
        <button class="btn qp-copy" data-quick-text="${safeAttr(p.text)}" type="button">复制</button>
      </div>`).join("")}
    </div>
  </div>`;
}

/* Update classDetailHtml to include quick phrases */
function classDetailHtml(item){
  const date=classRecordDate(item);
  const todayNote=classRecordTextForDate(item,date)||"";
  const history=(Array.isArray(item.classRecords)?item.classRecords:[])
    .filter(r=>r.date&&r.date!==date&&(r.notes||r.materials))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)))
    .slice(0,10);
  return `
  <div class="detail-section">
    <h4>上课信息</h4>
    <div class="detail-grid final-detail-grid">
      ${fieldCard("老师",item.teacher)}
      ${fieldCard("课程",item.courseType)}
      ${fieldCard("进度",lessonLabel(item))}
      ${fieldCard("主题",item.topic)}
      ${fieldCard("学期",classTermLabel(item))}
      ${fieldCard("Zoom 账号",zoomName(item))}
      ${fieldCard("学生",item.students.map(s=>s.name).join("、")||"暂无",true)}
    </div>
  </div>
  ${quickPhrasesHtml(item)}
  <div class="detail-section detail-note-section">
    <div class="note-section-head">
      <h4>${formatDateShort(date)} 课堂笔记</h4>
      ${history.length?`<button class="btn ghost detail-history-toggle" id="detailHistoryToggle" type="button">历史 (${history.length})</button>`:""}
    </div>
    <textarea id="detailNoteInput" class="detail-note-input" placeholder="今天发生了什么？只属于这一天。">${esc(todayNote)}</textarea>
    <button class="btn note-save-btn" id="detailNoteSave" type="button">保存笔记</button>
  </div>
  ${history.length?`<div class="detail-history-section" id="detailHistory" style="display:none">
    ${history.map(r=>`<div class="history-entry"><span class="history-date">${esc(formatDateShort(r.date))}</span><p>${esc(r.notes||r.materials||"")}</p></div>`).join("")}
  </div>`:""}`;
}

/* Update openClassDetailModal to bind quick phrase copy buttons */
function openClassDetailModal(item){
  const isDemo=String(item.id||"").startsWith("demo-");
  byId("detailTags").innerHTML=`<span class="scene-tag detail-day-tag">${esc(item.weekday)}</span><span class="audience-tag detail-status-tag">${esc(classTermLabel(item))}</span><span class="audience-tag detail-time-tag">${esc(countdownText(item))}</span>`;
  byId("detailTitle").textContent=(item.time?formatTimeCN(item.time)+" · ":"")+item.className;
  byId("detailContent").innerHTML=classDetailHtml(item);
  byId("detailOpenZoom").hidden=!item.zoomLink;
  byId("detailOpenZoom").onclick=()=>{if(item.zoomLink)window.open(item.zoomLink,"_blank");};
  byId("detailEdit").hidden=false;
  byId("detailEdit").textContent="去管理页编辑";
  byId("detailEdit").onclick=()=>{
    view="manage";manageMode="classes";
    manageClassSearch="";manageClassType="all"; // 清空筛选确保课程可见
    if(!isDemo){editingClassId=item.id;manageClassRecordDate="";}
    render();closeStickerDetail();
    // 滚动到选中项
    requestAnimationFrame(()=>{
      const active=document.querySelector(".course-list-item.active");
      if(active) active.scrollIntoView({block:"nearest",behavior:"smooth"});
    });
  };
  byId("detailCopy").hidden=isDemo;
  byId("detailCopy").textContent="复制课程信息";
  byId("detailCopy").onclick=()=>copyText(classDetailText(item));
  byId("detailModal").classList.add("show");
  byId("detailModal").setAttribute("aria-hidden","false");
  // Quick phrase copy buttons
  document.querySelectorAll("[data-quick-text]").forEach(btn=>{
    btn.addEventListener("click",()=>copyText(btn.dataset.quickText));
  });
  // Note save
  const saveBtn=byId("detailNoteSave");
  if(saveBtn) saveBtn.addEventListener("click",()=>{
    const textarea=byId("detailNoteInput");
    const notes=(textarea&&textarea.value||"").trim();
    const date=classRecordDate(item);
    const existing=scheduleData.find(x=>x.id===item.id);
    if(!existing) return;
    const records=Array.isArray(existing.classRecords)?existing.classRecords.slice():[];
    const idx=records.findIndex(r=>r.date===date);
    const rec={date,notes,materials:notes,updatedAt:new Date().toISOString()};
    if(idx>=0) records[idx]={...records[idx],...rec}; else records.push(rec);
    existing.classRecords=records;
    saveSchedule();
    showToast("已保存笔记");
  });
  // History toggle
  const toggleBtn=byId("detailHistoryToggle"),historySection=byId("detailHistory");
  if(toggleBtn&&historySection){
    const count=historySection.querySelectorAll(".history-entry").length;
    toggleBtn.addEventListener("click",()=>{
      const isVisible=historySection.style.display!=="none";
      historySection.style.display=isVisible?"none":"";
      toggleBtn.textContent=isVisible?`历史 (${count})`:"收起历史";
    });
  }
}

/* ============================================================
   REDESIGN: renderScheduleCard — compact, clear hierarchy
   ============================================================ */
function renderScheduleCard(x,active){
  const zoom=zoomName(x),status=cleanStatusList(x),teacher=x.teacher||"未填老师";
  const warnItems=status.filter(s=>s.includes("缺")||s.includes("未填"));
  const countdown=countdownText(x);
  return `<button class="schedule-card ${courseTone(x)} ${statusTone(x)} ${active?'active':''}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button">
    <div class="sc-top">
      <span class="sc-time">${esc(formatTimeCN(x.time))}</span>
      <span class="sc-pill">${esc(countdown)}</span>
    </div>
    <b class="sc-name">${esc(x.className)}</b>
    <div class="sc-meta">${esc(teacher)} · ${x.students.length||0}人 · ${esc(lessonLabel(x))}</div>
    ${zoom?`<div class="sc-zoom">Zoom · ${esc(zoom)}</div>`:""}
    ${warnItems.length?`<div class="sc-warn">${warnItems.map(esc).join(" · ")}</div>`:""}
  </button>`;
}

/* ============================================================
   REDESIGN: renderWeekLesson — compact for 7-column layout
   ============================================================ */
function renderWeekLesson(x){
  const zoom=zoomName(x),status=cleanStatusList(x);
  const warnItems=status.filter(s=>s.includes("缺"));
  return `<button class="week-lesson vertical-note readable-week-note ${courseTone(x)}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button" draggable="true">
    <span class="week-lesson-time">${esc(formatTimeCN(x.time))}</span>
    <b>${esc(x.className)}</b>
    <span class="wl-meta">${esc(x.teacher||"未填老师")} · ${x.students.length||0}人</span>
    ${zoom?`<span class="wl-zoom">${esc(zoom)}</span>`:""}
    ${warnItems.length?`<i>${warnItems.map(esc).join(" · ")}</i>`:""}
  </button>`;
}

/* ============================================================
   DRAG TO RESCHEDULE (B: one-time occurrence change)
   ============================================================ */
// 旧拖拽系统已停用，由下方 IIFE 统一处理
function setupDragDrop(){} // no-op

/* renderWeekCards with data-lane-date for drag-drop */
function renderWeekCards(classes){
  const start=activeWeekStart();
  return `<div class="week-planner week-vertical">
    <div class="week-planner-main">${WORKDAYS.map((day,i)=>{
      const d=addDays(start,i),items=classesOnDate(classes,d);
      return `<section class="weekday-lane ${dateKey(d)===dateKey(new Date())?'today':''} ${i>4?'weekend-lane':''}" data-lane-date="${safeAttr(dateKey(d))}">
        <div class="lane-head"><div><b>${esc(day)}</b><small>${dateLabel(d)}</small></div><span>${items.length} 节</span></div>
        <div class="lane-scroll">${items.map(renderWeekLesson).join("")||'<p class="no-class">没课</p>'}</div>
      </section>`;
    }).join("")}</div>
  </div>`;
}

/* FIX: renderRecentCourseCard — split time from name */
function renderRecentCourseCard(x){
  const occ=nextClassOccurrence(x);
  if(!occ) return "";
  const d=parseLocalDate(occ._occurrenceDate)||new Date();
  const dayText=`${todayName(daysBetween(d,new Date()))} ${(d.getMonth()+1)}/${d.getDate()}`;
  return `<button class="recent-course-card ${courseTone(x)}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(occ._occurrenceDate||"")}" type="button">
    <span class="recent-date">${esc(dayText)}</span>
    <div class="recent-name-row"><span class="recent-time">${esc(formatTimeCN(x.time))}</span><b>${esc(x.className)}</b></div>
    <small>${esc(x.teacher||"未填老师")} · ${x.students.length||0} 人 · ${esc(lessonLabel(x))}</small>
  </button>`;
}

/* ===================================================================
   FINAL DEFINITIVE FIXES
   =================================================================== */

/* 1. classDetailHtml — NO quick phrases, clean */
function classDetailHtml(item){
  const date=classRecordDate(item);
  const todayNote=classRecordTextForDate(item,date)||"";
  const noteRecords=(Array.isArray(item.classRecords)?item.classRecords:[])
    .filter(r=>r.date&&r.date!==date&&(r.notes||r.materials));
  const todoByDate=allTodosForClassByDate(item.id);
  // 合并所有有记录的日期（笔记或 todo）
  const allDates=new Set([
    ...noteRecords.map(r=>r.date),
    ...Object.keys(todoByDate).filter(d=>d!==date)
  ]);
  const merged=[...allDates].sort((a,b)=>b.localeCompare(a)).slice(0,15).map(d=>{
    const rec=noteRecords.find(r=>r.date===d);
    const todos=todoByDate[d]||[];
    return {date:d,notes:rec?rec.notes||rec.materials||"":"",todos};
  }).filter(e=>e.notes||e.todos.length);
  const historyHtml=merged.map(e=>`<div class="history-entry">
    <span class="history-date">${esc(formatDateShort(e.date))}</span>
    ${e.notes?`<p>${esc(e.notes)}</p>`:""}
    ${e.todos.length?`<div class="history-todos">${e.todos.map(t=>`<span class="history-todo-item ${t.done?"done":""}">${t.done?"✓ ":"○ "}${esc(t.text)}</span>`).join("")}</div>`:""}
  </div>`).join("");
  const todayTodos=(todoByDate[date]||[]);
  const todayTodosHtml=todayTodos.length?`<div class="today-todo-in-detail"><b>今日关联待办</b><div class="history-todos">${todayTodos.map(t=>`<span class="history-todo-item ${t.done?"done":""}">${t.done?"✓ ":"○ "}${esc(t.text)}</span>`).join("")}</div></div>`:"";
  return `<div class="detail-section"><h4>上课信息</h4><div class="detail-grid final-detail-grid">${fieldCard("老师",item.teacher)}${fieldCard("课程",item.courseType)}${fieldCard("进度",lessonLabel(item))}${fieldCard("主题",item.topic)}${fieldCard("学期",classTermLabel(item))}${fieldCard("Zoom",zoomName(item))}${fieldCard("学生",item.students.map(s=>s.name).join("、")||"暂无",true)}</div></div><div class="detail-section detail-note-section"><div class="note-section-head"><h4>${formatDateShort(date)} 课堂笔记</h4>${merged.length?`<button class="btn ghost detail-history-toggle" id="detailHistoryToggle" type="button">历史 (${merged.length})</button>`:""}</div>${todayTodosHtml}<textarea id="detailNoteInput" class="detail-note-input" placeholder="今天发生了什么？只属于这一天。">${esc(todayNote)}</textarea><button class="btn note-save-btn" id="detailNoteSave" type="button">保存笔记</button></div>${merged.length?`<div class="detail-history-section" id="detailHistory" style="display:none">${historyHtml}</div>`:""}`;
}

/* 2. renderMonthLesson — add draggable="true" */
function renderMonthLesson(x){
  const zoom=zoomName(x);
  return `<button class="month-lesson ${courseTone(x)}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(x._occurrenceDate||"")}" type="button" draggable="true">
    <span class="month-lesson-time">${esc(formatTimeCN(x.time))}</span>
    <span class="month-lesson-body"><b>${esc(x.className)}</b><small>${esc(x.teacher||"未填老师")} · ${zoom?esc(zoom):"未填 Zoom"} · ${esc(lessonLabel(x))}</small></span>
    <em>${esc(countdownText(x))}</em>
  </button>`;
}

/* 3. Drag-drop via event delegation — survives DOM re-renders */
(function(){
  var _cid=null,_odate=null;

  document.addEventListener("dragstart",function(e){
    const el=e.target.closest("[data-schedule-id][data-occurrence-date]");
    if(!el) return;
    _cid=el.dataset.scheduleId;
    _odate=el.dataset.occurrenceDate;
    e.dataTransfer.effectAllowed="move";
    e.dataTransfer.setData("text/plain",_cid);
    setTimeout(()=>el.classList.add("dragging"),0);
  },false);

  document.addEventListener("dragend",function(e){
    const el=e.target.closest("[data-schedule-id]");
    if(el) el.classList.remove("dragging");
    document.querySelectorAll(".drop-target").forEach(z=>z.classList.remove("drop-target"));
  },false);

  document.addEventListener("dragover",function(e){
    const zone=e.target.closest(".weekday-lane[data-lane-date],.month-dot-cell:not(.muted)[data-month-day]");
    if(!zone||!_cid) return;
    e.preventDefault();
    e.dataTransfer.dropEffect="move";
    document.querySelectorAll(".drop-target").forEach(z=>{if(z!==zone)z.classList.remove("drop-target");});
    zone.classList.add("drop-target");
  },false);

  document.addEventListener("dragleave",function(e){
    const zone=e.target.closest(".weekday-lane,.month-dot-cell");
    if(zone&&!zone.contains(e.relatedTarget)) zone.classList.remove("drop-target");
  },false);

  document.addEventListener("drop",function(e){
    const zone=e.target.closest(".weekday-lane[data-lane-date],.month-dot-cell:not(.muted)[data-month-day]");
    if(!zone){_cid=null;_odate=null;return;}
    e.preventDefault();
    document.querySelectorAll(".drop-target").forEach(z=>z.classList.remove("drop-target"));
    const newDate=zone.dataset.laneDate||zone.dataset.monthDay;
    if(!newDate||!_cid||newDate===_odate){_cid=null;_odate=null;return;}
    const cls=scheduleData.find(x=>x.id===_cid);
    if(cls){
      // 每次拖拽都要清理上一次的记录，才能反复拖
      let skipped=(cls.skippedDates||[]).slice()
        .filter(d=>d!==newDate);           // 目标日期从"跳过"里移除
      if(_odate&&!skipped.includes(_odate)) skipped.push(_odate); // 源日期加入跳过
      cls.skippedDates=skipped;
      let dates=(cls.repeatDates||[]).slice()
        .filter(d=>d!==_odate);            // 源日期从"额外显示"里移除
      if(!dates.includes(newDate)) dates.push(newDate); // 目标日期加入额外显示
      cls.repeatDates=dates;
      saveSchedule();
      showToast(`已改到 ${newDate}`);
      render();
    }
    _cid=null;_odate=null;
  },false);
})();

/* 4. renderTodoNotebook — compact "+" button design */
function renderTodoNotebook(day,items){
  var dayKey=dateKey(day);
  var allTodos=readDailyTodos();
  var todos=Array.isArray(allTodos[dayKey])?allTodos[dayKey]:[];
  var isToday=dayKey===dateKey(new Date());
  var allCourses=activeClasses();
  var classOpts=allCourses.length?`<select id="todoClassLink" class="todo-class-select-mini"><option value="">↳ 不关联课程</option>${allCourses.map(c=>`<option value="${safeAttr(c.id)}|${safeAttr(dayKey)}">${esc(c.weekday)} ${esc(formatTimeCN(c.time))} ${esc(c.className)}</option>`).join("")}</select>`:"";
  return `<section class="todo-notebook today-summary">
    <div class="todo-top">
      <div><span>当天待办</span><h3>${isToday?"今天":dateLabel(day)}</h3></div>
      <input id="todoDatePicker" type="date" value="${safeAttr(dayKey)}">
    </div>
    <div class="todo-date-nav">
      <button class="btn" data-todo-move="-1" type="button">前一天</button>
      <b>${monthTitle(day)} ${day.getDate()} · ${todayName(daysBetween(day,new Date()))}</b>
      <button class="btn" data-todo-move="1" type="button">后一天</button>
    </div>
    <div class="todo-list">
      ${todos.map(function(todo,i){return `<div class="todo-item ${todo.done?'done':''}">
        <button class="todo-check" data-todo-toggle="${i}" type="button"></button>
        <span class="todo-text">${esc(todo.text)}${todo.classLinkName?`<em class="todo-class-badge">↳${esc(todo.classLinkName)}</em>`:""}</span>
        <button class="todo-delete" data-todo-delete="${i}" type="button">✕</button>
      </div>`;}).join("")||`<div class="todo-empty">还没有待办，随手加一条。</div>`}
    </div>
    <div class="todo-compact-add">
      <input id="todoInput" class="todo-compact-input" placeholder="随手记…" value="${safeAttr(_todoInputCache||"")}">
      <button id="todoAdd" class="todo-plus-btn" type="button" data-todo-day="${safeAttr(dayKey)}">+</button>
      ${classOpts}
    </div>
  </section>`;
}

/* Colored filterBar — adds filter-tag-{value} class for CSS color coding */
function filterBar(prefix,scene,audience,auto=false){
  const sceneItems=[...(auto?[{value:"auto",label:"自动"}]:[]),{value:"all",label:"全部"},...SCENES.map(x=>({value:x,label:x==="ai"?"AI":SCENE_LABELS[x]}))];
  const audItems=[{value:"all",label:"全部"},...AUDIENCE_FILTERS.map(x=>({value:x,label:AUDIENCE_LABELS[x]}))];
  const makeBtn=(x,current,key)=>`<button class="tab filter-tag-${x.value} ${x.value===current?'active':''}" data-${key}="${safeAttr(x.value)}">${esc(x.label)}</button>`;
  return `<div class="filter-line compact-filter">${sceneItems.map(x=>makeBtn(x,scene,prefix+"Scene")).join("")}</div><div class="filter-line compact-filter">${audItems.map(x=>makeBtn(x,audience,prefix+"Audience")).join("")}</div>`;
}

/* Fix: search boxes — update list only, keep focus, no full render */
function refreshManageStickerList(){
  const listEl=document.querySelector(".sticker-manage .item-list");
  if(!listEl) return;
  const list=filterStickersWithSearch(stickersData.filter(x=>!x.deletedAt),manageStickerScene,manageStickerAudience,manageStickerSearch);
  listEl.innerHTML=list.map(x=>{const note=(x.note||"").trim();return `<button class="list-item ${x.id===editingStickerId?'active':''}" data-edit-sticker="${safeAttr(x.id)}"><b>${esc(x.title)}</b><span>${SCENE_LABELS[x.scene]} · ${AUDIENCE_LABELS[x.audience]}${x.archivedAt?' · 已归档':''}</span>${note?`<em class="list-note-badge">${esc(note)}</em>`:""}</button>`;}).join("")||'<p class="empty">没找到。</p>';
  document.querySelectorAll("[data-edit-sticker]").forEach(b=>b.addEventListener("click",()=>{editingStickerId=b.dataset.editSticker;render();}));
}
function refreshManageClassList(){
  const listEl=document.querySelector(".class-manage .item-list");
  if(!listEl) return;
  const list=filterClassesForManage(scheduleData.filter(x=>x.status!=="Deleted"));
  listEl.innerHTML=list.map(x=>`<button class="list-item course-list-item ${x.id===editingClassId?'active':''}" data-edit-class="${safeAttr(x.id)}"><b>${esc(x.weekday)} ${esc(formatTimeCN(x.time)||"未定")} · ${esc(x.className)}</b><span>${esc(courseTypeLabel(x))} · ${esc(x.teacher||"未填老师")} · ${esc(classTermLabel(x))}</span></button>`).join("")||'<p class="empty">没找到。</p>';
  document.querySelectorAll("[data-edit-class]").forEach(b=>b.addEventListener("click",()=>{editingClassId=b.dataset.editClass;manageClassRecordDate="";render();}));
}
// capture:true so this runs BEFORE the element-level handler that calls render()
// stopImmediatePropagation prevents the render() handler from ever firing
document.addEventListener("input",function(e){
  const t=e.target;
  if(t.id==="manageStickerSearch"){
    e.stopImmediatePropagation();
    manageStickerSearch=t.value;
    refreshManageStickerList();
  } else if(t.id==="manageClassSearch"){
    e.stopImmediatePropagation();
    manageClassSearch=t.value;
    refreshManageClassList();
  }
},true);

// Fix 5: record chip click — update fields in-place, NO full re-render (no page jump)
document.addEventListener("click",function(e){
  const chip=e.target.closest&&e.target.closest("[data-load-class-record]");
  if(!chip||manageMode!=="classes"||!editingClassId) return;
  e.stopImmediatePropagation();
  const date=chip.dataset.loadClassRecord;
  manageClassRecordDate=date;
  const cls=scheduleData.find(x=>x.id===editingClassId);
  if(!cls) return;
  const dateInput=byId("classRecordDate");
  const reportTA=byId("classReport");
  if(dateInput) dateInput.value=date;
  if(reportTA) reportTA.value=classRecordTextForDate(cls,date)||"";
  document.querySelectorAll(".record-chip").forEach(c=>c.classList.toggle("active",c.dataset.loadClassRecord===date));
},true);

/* Fix: correct bindTodayEvents — matches actual HTML attribute names from renderTodoNotebook */
function bindTodayEvents(){
  document.querySelectorAll("[data-scheduleMode]").forEach(b=>b.addEventListener("click",()=>{scheduleMode=b.dataset.schedulemode;render();}));
  document.querySelectorAll("[data-week-move]").forEach(b=>b.addEventListener("click",()=>{finalWeekOffset+=Number(b.dataset.weekMove)||0;render();}));
  document.querySelectorAll("[data-week-reset]").forEach(b=>b.addEventListener("click",()=>{finalWeekOffset=0;render();}));
  document.querySelectorAll("[data-month-move]").forEach(b=>b.addEventListener("click",()=>{calendarMonthOffset+=Number(b.dataset.monthMove);monthSelectedDate="";render();}));
  document.querySelectorAll("[data-month-current]").forEach(b=>b.addEventListener("click",()=>{calendarMonthOffset=0;monthSelectedDate=dateKey(new Date());render();}));
  document.querySelectorAll("[data-month-day]").forEach(b=>b.addEventListener("click",()=>{monthSelectedDate=b.dataset.monthDay;render();}));
  document.querySelectorAll("[data-schedule-add-class]").forEach(b=>b.addEventListener("click",()=>{view="manage";manageMode="classes";editingClassId=null;manageClassSearch="";render();}));
  // Todo 日期切换；添加/勾选/删除在文件末尾的文档级委托里统一处理，这里不重复绑定
  document.querySelectorAll("[data-todo-move]").forEach(b=>b.addEventListener("click",()=>{todoDateOffset+=Number(b.dataset.todoMove);render();}));
  const picker=byId("todoDatePicker");
  if(picker) picker.addEventListener("change",()=>{const picked=parseLocalDate(picker.value);if(picked){todoDateOffset=daysBetween(picked,new Date());render();}});
}

/* ===== 统一 TODO 处理 ===== */
/* 用全局变量缓存输入值，避免 DOM 被刷新后丢失 */
var _todoInputCache="";
var _todoLinkCache="";

/* 监听每次打字，实时缓存 */
document.addEventListener("input",function(e){
  if(e.target&&e.target.id==="todoInput"){
    _todoInputCache=e.target.value;
  }
  if(e.target&&e.target.id==="todoClassLink"){
    _todoLinkCache=e.target.value;
  }
},true);

/* 核心：添加 todo */
function _doAddTodo(){
  var text=_todoInputCache.trim();
  /* 双保险：如果缓存为空，再尝试直接读 DOM */
  if(!text){
    var el=document.getElementById("todoInput");
    if(el) text=el.value.trim();
  }
  if(!text){
    showToast("请先输入内容");
    return;
  }
  try{
    var day=todoDate();
    var items=classesOnDate(displayClasses(),day);
    var todos=todosForDay(day,items);
    var linkVal=_todoLinkCache.trim();
    /* 再试读 DOM */
    if(!linkVal){
      var linkEl=document.getElementById("todoClassLink");
      if(linkEl) linkVal=linkEl.value.trim();
    }
    var classLinkName="";
    if(linkVal){
      var cid=linkVal.split("|")[0];
      var cls=scheduleData.find(function(x){return x.id===cid;});
      if(cls) classLinkName=cls.className||"";
    }
    todos.push({id:uid("todo"),text:text,done:false,classLink:linkVal||undefined,classLinkName:classLinkName||undefined});
    var all=readDailyTodos();
    var dk=dateKey(day);
    all[dk]=todos;
    localStorage.setItem(DAILY_TODO_KEY,JSON.stringify(all));
    if(currentUser) syncToCloud().catch(function(e){console.warn("sync failed",e);});
    /* 清缓存 */
    _todoInputCache="";
    _todoLinkCache="";
    var inp=document.getElementById("todoInput");
    if(inp) inp.value="";
    render();
    showToast("已添加："+text);
  }catch(e){
    showToast("添加失败："+e.message);
    console.error("_doAddTodo error:",e);
  }
}

/* 单一事件委托：所有 todo 操作 */
document.addEventListener("click",function(e){
  if(!e.target) return;
  /* + 按钮 */
  var t=e.target;
  if(t.id==="todoAdd"||t.classList.contains("todo-plus-btn")||(t.parentElement&&(t.parentElement.id==="todoAdd"||t.parentElement.classList.contains("todo-plus-btn")))){
    e.stopPropagation();
    _doAddTodo();
    return;
  }
  /* 勾选完成 */
  var toggle=t.closest?t.closest("[data-todo-toggle]"):null;
  if(!toggle&&t.parentElement) toggle=t.parentElement.closest?t.parentElement.closest("[data-todo-toggle]"):null;
  if(toggle){
    e.stopPropagation();
    try{
      var i=Number(toggle.dataset.todoToggle);
      var day=todoDate();
      var items=classesOnDate(displayClasses(),day);
      var todos=todosForDay(day,items);
      if(todos[i]){
        todos[i].done=!todos[i].done;
        var all=readDailyTodos();
        all[dateKey(day)]=todos;
        localStorage.setItem(DAILY_TODO_KEY,JSON.stringify(all));
        if(currentUser) syncToCloud().catch(function(e){console.warn("sync",e);});
        render();
      }
    }catch(err){console.error("toggle error:",err);}
    return;
  }
  /* 删除 */
  var del=t.closest?t.closest("[data-todo-delete]"):null;
  if(!del&&t.parentElement) del=t.parentElement.closest?t.parentElement.closest("[data-todo-delete]"):null;
  if(del){
    e.stopPropagation();
    try{
      var i2=Number(del.dataset.todoDelete);
      var day2=todoDate();
      var items2=classesOnDate(displayClasses(),day2);
      var todos2=todosForDay(day2,items2);
      todos2.splice(i2,1);
      var all2=readDailyTodos();
      all2[dateKey(day2)]=todos2;
      localStorage.setItem(DAILY_TODO_KEY,JSON.stringify(all2));
      if(currentUser) syncToCloud().catch(function(e){console.warn("sync",e);});
      render();
    }catch(err2){console.error("delete error:",err2);}
    return;
  }
},true); /* capture: true 最先触发，不被其他处理器抢先 */

/* Enter 键 */
document.addEventListener("keydown",function(e){
  if(e.key==="Enter"&&e.target&&e.target.id==="todoInput"){
    e.preventDefault();
    e.stopPropagation();
    _doAddTodo();
  }
},true);
