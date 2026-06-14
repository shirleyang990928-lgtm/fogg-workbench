/* ===== 版本号：每次改完代码请同步更新，用于确认浏览器没有在用旧缓存 ===== */
const APP_VERSION='20260614e';
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
  autoCloseFinishedClasses();
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
let adminViewTodos=null; // 管理员查看他人时，存放对方的待办（只读展示用）

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
    adminViewTodos=null;
    stickersData=loadCollection(STORAGE_KEYS.stickers,DEFAULT_STICKERS,normalizeSticker);
    scheduleData=loadCollection(STORAGE_KEYS.schedule,DEFAULT_SCHEDULE,normalizeClassItem);
    studentsData=loadCollection(STORAGE_KEYS.students,[],normalizeStudentProfile);
    sopData=loadCollection(STORAGE_KEYS.sop,[],normalizeSopRole);
    document.getElementById('adminBar').textContent='🔍 管理员视角：自己';
    showToast('已切回自己的数据');render();return;
  }
  const {data,error}=await sb.from('user_data').select('*').eq('user_email',email).single();
  if(error||!data){showToast('该用户暂无云端记录，可直接在输入框填 email 清空');return;}
  adminViewEmail=email;
  stickersData=(data.stickers||[]).map(normalizeSticker);
  scheduleData=(data.schedule||[]).map(normalizeClassItem);
  studentsData=(data.students||[]).map(normalizeStudentProfile);
  // 对方的待办也载入（坏格式先归一成 {日期:[...]} 对象），查看期间只读
  let viewTodos=data.todos;
  if(typeof viewTodos==='string'){try{viewTodos=JSON.parse(viewTodos);}catch(e){viewTodos={};}}
  if(!viewTodos||typeof viewTodos!=='object'||Array.isArray(viewTodos)) viewTodos={};
  adminViewTodos=viewTodos;
  document.getElementById('adminBar').textContent='🔍 正在查看：'+email+' （含待办，只读，点此切回自己）';
  showToast('已切换到：'+email+'（课表/话术/待办均为对方数据，只读）');render();
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
  askConfirm('确认清空 '+target+' 的所有班级、话术和待办？此操作不可撤销。',async()=>{
    await sb.from('user_data').upsert({user_email:target,stickers:[],schedule:[],todos:{},updated_at:new Date().toISOString()},{onConflict:'user_email'});
    if(target===currentUser.email){
      Object.values(STORAGE_KEYS).forEach(k=>localStorage.removeItem(k));
      localStorage.removeItem(DAILY_TODO_KEY);
      stickersData=[];scheduleData=[];
      render();
    }
    if(input) input.value='';
    showToast('已清空 '+target+' 的所有数据');
  },{okText:'清空',icon:'⚠️'});
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
  studentsData=[];
  sopData=[];
  if(data){
    localStorage.setItem(STORAGE_KEYS.stickers,JSON.stringify(data.stickers||[]));
    localStorage.setItem(STORAGE_KEYS.schedule,JSON.stringify(data.schedule||[]));
    localStorage.setItem(STORAGE_KEYS.students,JSON.stringify(data.students||[]));
    localStorage.setItem(STORAGE_KEYS.sop,JSON.stringify(data.sop||[]));
    studentsData=(data.students||[]).map(normalizeStudentProfile);
    sopData=(data.sop||[]).map(normalizeSopRole);
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
  // 管理员正在查看他人数据时禁止同步：此刻内存里是对方的课表/话术，
  // 一旦上传会写进自己的云端记录，覆盖自己的真实数据
  if(adminViewEmail)return;
  try{
    const todos=readDailyTodos();
    await sb.from('user_data').upsert({
      user_email:currentUser.email,
      stickers:stickersData,
      schedule:scheduleData,
      students:studentsData,
      sop:sopData,
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
const STORAGE_KEYS = {stickers:"stickersData", schedule:"scheduleData", students:"studentsData", sop:"sopData", stickerCategories:"stickerCategories", courseCategories:"courseCategories"};
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
let studentsData = loadCollection(STORAGE_KEYS.students, [], normalizeStudentProfile);
let sopData = loadCollection(STORAGE_KEYS.sop, [], normalizeSopRole);
function uid(prefix){return prefix+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7);}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
function safeAttr(s){return esc(s).replace(/`/g,"&#096;");}
function byId(id){return document.getElementById(id);}
/* 文本域随内容自动长高，不出现内部滚动条（点名表现栏、笔记栏用）v20260612d */
function autoGrowArea(el){if(!el)return;el.style.height="auto";el.style.height=(el.scrollHeight+2)+"px";}
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
function updateClock(){const now=new Date();let h=now.getHours();const ampm=h>=12?"PM":"AM";h=h%12||12;byId("time").innerHTML=h+":"+String(now.getMinutes()).padStart(2,"0")+" <small>"+ampm+"</small>";byId("date").innerHTML="<b>"+(now.getMonth()+1)+"月"+now.getDate()+"日</b><i>"+WEEKDAYS[now.getDay()]+"</i>";}
function todayName(offset=0){const d=new Date();d.setDate(d.getDate()+offset);return WEEKDAYS[d.getDay()];}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}
function weekStart(d=new Date()){const x=new Date(d);const day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);x.setHours(0,0,0,0);return x;}
function dateLabel(d){return (d.getMonth()+1)+"/"+d.getDate();}
function monthTitle(d=new Date()){return d.getFullYear()+"年"+(d.getMonth()+1)+"月";}
function dateKey(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
function parseLocalDate(s){const m=String(s||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?new Date(Number(m[1]),Number(m[2])-1,Number(m[3])):null;}
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
function render(){updateNav();if(view==="today")renderToday();if(view==="stickers")renderStickers();if(view==="courses")renderCourses();if(view==="students")renderStudents();if(view==="teachers")renderTeachers();if(view==="manage")renderManage();if(view==="courseHome")renderCourseHome();if(view==="sop")renderSop();}
/* 页内筛选用这个重渲染：保住滚动位置，不再跳回顶部（Shirley 点学生页筛选会回跳的 bug）。
   有的页是 #content 在滚，有的页（学生页）是里面的面板在滚，所以把所有滚着的容器都记下来。 */
function rerenderKeepScroll(){
  const saved=[];
  const root=byId("content");
  if(root){
    if(root.scrollTop>0)saved.push({sel:"#content",top:root.scrollTop});
    root.querySelectorAll("*").forEach(el=>{
      if(el.scrollTop>0&&el.className&&typeof el.className==="string"){
        saved.push({sel:"."+el.className.trim().split(/\s+/).join("."),top:el.scrollTop});
      }
    });
  }
  render();
  saved.forEach(s=>{
    try{const el=document.querySelector(s.sel);if(el)el.scrollTop=s.top;}catch(e){}
  });
}
function renderFocus(current,suggested){if(!current)return `<div class="panel-head"><h3>\u5f53\u524d\u4efb\u52a1</h3><span>\u6682\u65e0\u8bfe\u7a0b</span></div><p class="empty">\u4eca\u5929\u6ca1\u6709\u8bfe\u65f6\uff0c\u5de5\u4f5c\u53f0\u4f1a\u81ea\u52a8\u663e\u793a\u6700\u8fd1\u7684\u8fdb\u884c\u4e2d\u8bfe\u7a0b\u3002</p>`;return `<div class="panel-head"><h3>\u5f53\u524d\u4efb\u52a1</h3><span>\u5efa\u8bae\uff1a${SCENE_LABELS[suggested]}</span></div><div class="focus-card"><div class="focus-top"><div><div class="course-time">${esc(current.time||"\u672a\u5b9a")}</div><div class="course-name">${esc(current.className)}</div></div><span class="chip ok">${STATUS_LABELS[current.status]}</span></div><div class="meta-row"><span class="chip">${esc(current.weekday)}</span><span class="chip">${esc(current.courseType)}</span><span class="chip">${esc(current.teacher||"\u672a\u586b\u8001\u5e08")}</span></div><div class="student-row">${current.students.map(s=>`<span class="chip">${esc(s.name)}</span>`).join("")||'<span class="chip">\u6682\u65e0\u5b66\u751f</span>'}</div><div class="course-note">${esc((current.notes[0]&&current.notes[0].text)||"\u6682\u65e0\u5907\u6ce8\u3002")}</div></div>`;}
function renderCourseCards(classes,current){return `<div class="course-card-grid">${classes.map(x=>renderScheduleCard(x,current&&x.id===current.id)).join("")||'<p class="empty">\u6682\u65e0\u53ef\u663e\u793a\u8bfe\u7a0b\u3002</p>'}</div>`;}
function renderDayColumn(day,items){return `<section class="week-day-card"><div class="day-card-head"><b>${esc(day)}</b><span>${items.length} \u8282</span></div><div class="day-card-list">${items.map(x=>renderScheduleCard(x,false)).join("")||'<p class="empty mini">\u6ca1\u8bfe</p>'}</div></section>`;}
function bindScheduleCards(list=displayClasses()){document.querySelectorAll("[data-schedule-id]").forEach(btn=>btn.addEventListener("click",()=>{let item=list.find(x=>x.id===btn.dataset.scheduleId)||scheduleData.find(x=>x.id===btn.dataset.scheduleId);const d=parseLocalDate(btn.dataset.occurrenceDate);if(item&&d)item=classesOnDate([item],d)[0]||item;if(item)openClassDetailModal(item);}));}
function bindCopy(list){document.querySelectorAll("[data-copy-id]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();const item=list.find(x=>x.id===btn.dataset.copyId);if(item)copyText(item.content);}));}
function bindDetail(list){document.querySelectorAll("[data-detail-id]").forEach(btn=>btn.addEventListener("click",()=>{const item=list.find(x=>x.id===btn.dataset.detailId);if(item)openStickerDetail(item);}));}
function closeStickerDetail(){byId("detailModal").classList.remove("show");byId("detailModal").setAttribute("aria-hidden","true");document.body.focus();if(recordDateOverride){recordDateOverride="";if(view==="courseHome")render();}}
function renderManage(){setHead("\u7ba1\u7406","\u5206\u6b65\u6574\u7406\u8bdd\u672f\u3001\u8bfe\u7a0b\u3001\u56de\u6536\u7ad9\u548c\u5907\u4efd","");byId("tabs").innerHTML=tabs([{value:"home",label:"\u5165\u53e3"},{value:"stickers",label:"\u7ba1\u7406\u8bdd\u672f"},{value:"classes",label:"\u7ba1\u7406\u8bfe\u7a0b"},{value:"trash",label:"\u56de\u6536\u7ad9"},{value:"backup",label:"\u5907\u4efd"}],manageMode,"manage");if(manageMode==="home")renderManageHome();if(manageMode==="stickers")renderStickerManage();if(manageMode==="classes")renderClassManage();if(manageMode==="trash")renderTrash();if(manageMode==="backup")renderBackup();bindManageEvents();}
function renderTrash(){const ss=stickersData.filter(x=>x.deletedAt), cs=scheduleData.filter(x=>x.status==="Deleted");byId("content").innerHTML=`<div class="grid-2"><section class="panel"><div class="panel-head"><h3>\u5df2\u5220\u9664\u8bdd\u672f</h3><span>${ss.length}</span></div><div class="trash-grid">${ss.map(x=>`<div class="list-item"><b>${esc(x.title)}</b><span>${SCENE_LABELS[x.scene]} · ${AUDIENCE_LABELS[x.audience]}</span><div class="form-actions"><button class="btn" data-restore-sticker="${safeAttr(x.id)}">\u6062\u590d</button><button class="btn danger" data-purge-sticker="${safeAttr(x.id)}">\u5f7b\u5e95\u5220\u9664</button></div></div>`).join("")||'<p class="empty">\u6ca1\u6709\u5df2\u5220\u9664\u8bdd\u672f\u3002</p>'}</div></section><section class="panel"><div class="panel-head"><h3>\u5df2\u5220\u9664\u8bfe\u7a0b</h3><span>${cs.length}</span></div><div class="trash-grid">${cs.map(x=>`<div class="list-item"><b>${esc(x.className)}</b><span>${esc(x.weekday)} ${esc(x.time)}</span><div class="form-actions"><button class="btn" data-restore-class="${safeAttr(x.id)}">\u6062\u590d</button><button class="btn danger" data-purge-class="${safeAttr(x.id)}">\u5f7b\u5e95\u5220\u9664</button></div></div>`).join("")||'<p class="empty">\u6ca1\u6709\u5df2\u5220\u9664\u8bfe\u7a0b\u3002</p>'}</div></section></div>`;}
function renderBackup(){
  byId("content").innerHTML=`<div class="grid-2 backup-grid">
  <section class="panel backup-box"><div class="panel-head"><h3>\u5907\u4efd</h3><span>\u5bfc\u51fa\u540e\u53ef\u4fdd\u5b58\u5230\u672c\u5730</span></div><textarea id="backupText" placeholder="\u70b9\u51fb\u5bfc\u51fa\u540e\u4f1a\u51fa\u73b0 JSON"></textarea><div class="form-actions"><button class="btn primary" data-export-all>\u5bfc\u51fa\u5168\u90e8</button><button class="btn" data-import-all>\u5bfc\u5165</button></div></section>
  ${testDataPanelHtml()}</div>`;
  bindTestDataButtons();
}
function saveStickerFromForm(){const item=normalizeSticker({id:editingStickerId||uid("sticker"),scene:byId("stickerScene").value,audience:byId("stickerAudience").value,title:byId("stickerTitle").value||"\u672a\u547d\u540d\u8bdd\u672f",content:byId("stickerContent").value,note:byId("stickerNote").value});const idx=stickersData.findIndex(x=>x.id===editingStickerId);if(idx>=0)stickersData[idx]={...stickersData[idx],...item};else stickersData.push(item);editingStickerId=item.id;saveStickers();showToast("\u5df2\u4fdd\u5b58\u8bdd\u672f");render();}
function parseStudents(text){return text.split(/\n+/).map(x=>x.trim()).filter(Boolean).map(line=>{const [name,...note]=line.split("|");return {id:uid("student"),name:name.trim(),note:note.join("|").trim()};});}
function importAll(){try{const data=JSON.parse(byId("backupText").value);if(Array.isArray(data.stickers))stickersData=data.stickers.map(normalizeSticker);if(Array.isArray(data.classes))scheduleData=data.classes.map(normalizeClassItem);if(Array.isArray(data.stickerCategories)&&data.stickerCategories.length){stickerCategories=data.stickerCategories.map(normalizeCategory);localStorage.setItem(STORAGE_KEYS.stickerCategories,JSON.stringify(stickerCategories));}if(Array.isArray(data.courseCategories)&&data.courseCategories.length){courseCategories=data.courseCategories.map(normalizeCategory);localStorage.setItem(STORAGE_KEYS.courseCategories,JSON.stringify(courseCategories));}saveStickers();saveSchedule();showToast("\u5bfc\u5165\u6210\u529f");render();}catch(e){showToast("\u5bfc\u5165\u5931\u8d25\uff0c\u8bf7\u786e\u8ba4\u683c\u5f0f\uff1aJSON \u5305\u542b stickers \u548c classes \u6570\u7ec4");}}
async function copyText(text){let ok=false;try{await navigator.clipboard.writeText(text);ok=true;}catch(e){const ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.left="-9999px";document.body.appendChild(ta);ta.select();try{ok=document.execCommand("copy");}catch(err){}document.body.removeChild(ta);}showToast(ok?"\u5df2\u590d\u5236":"\u590d\u5236\u88ab\u62e6\u622a");}
function showToast(msg){const toast=byId("toast");toast.textContent=msg;toast.classList.add("show");setTimeout(()=>toast.classList.remove("show"),1200);}

/* 自定义确认弹窗（v20260613b，Shirley：不要浏览器那个丑确认框，所有删除/危险操作都走这个统一的好看弹窗）
   用法：askConfirm("要删吗？", ()=>{ 真正执行的代码 }, {danger:true, okText:"删除", icon:"🗑"}) */
function askConfirm(message,onYes,opts){
  opts=opts||{};
  let ov=byId("confirmModal");
  if(!ov){
    ov=document.createElement("div");
    ov.id="confirmModal";
    ov.className="confirm-modal";
    ov.innerHTML=`<div class="confirm-card" role="alertdialog" aria-modal="true">
      <div class="confirm-icon"></div>
      <p class="confirm-msg"></p>
      <div class="confirm-actions">
        <button class="btn confirm-cancel" type="button"></button>
        <button class="btn confirm-ok" type="button"></button>
      </div></div>`;
    document.body.appendChild(ov);
  }
  const danger=opts.danger!==false; // 默认按危险（红）处理
  ov.querySelector(".confirm-icon").textContent=opts.icon||(danger?"🗑":"❓");
  ov.querySelector(".confirm-msg").textContent=message;
  const okBtn=ov.querySelector(".confirm-ok");
  const cancelBtn=ov.querySelector(".confirm-cancel");
  okBtn.textContent=opts.okText||(danger?"删除":"确定");
  cancelBtn.textContent=opts.cancelText||"取消";
  okBtn.className="btn confirm-ok "+(danger?"danger":"primary");
  const close=()=>{ov.classList.remove("open");okBtn.onclick=cancelBtn.onclick=ov.onclick=document.onkeydown=null;};
  okBtn.onclick=()=>{close();if(onYes)onYes();};
  cancelBtn.onclick=close;
  ov.onclick=e=>{if(e.target===ov)close();};
  document.onkeydown=e=>{if(e.key==="Escape")close();};
  ov.classList.add("open");
  cancelBtn.focus();
}
let librarySearch = "", manageStickerSearch = "", monthSelectedDate = dateKey(new Date());

function statusTone(x){const text=countdownText(x);if(text.includes("上课中"))return "now";if(text.includes("还有"))return "soon";if(text.includes("已"))return "past";return "plain";}
function filterStickersWithSearch(list,scene,audience,keyword){const q=(keyword||"").trim().toLowerCase();return filterStickers(list,scene,audience).filter(x=>!q||[x.title,x.content,SCENE_LABELS[x.scene],AUDIENCE_LABELS[x.audience],x.note,x.tags].join(" ").toLowerCase().includes(q));}
function fieldCard(label,value,wide=false){return `<div class="detail-line ${wide?'wide':''}"><span>${esc(label)}</span><b>${esc(value||"未填")}</b></div>`;}

function renderMonthCourse(x){return renderScheduleCard(x,false);}
let calendarMonthOffset = 0;

function weekRangeLabel(){const start=weekStart(),end=addDays(start,6);return `${dateLabel(start)} - ${dateLabel(end)}`;}
function addMonths(d,n){const x=new Date(d);x.setMonth(x.getMonth()+n);return x;}
function compactStatusList(x){const list=[];if(!zoomName(x))list.push("未填 Zoom");if(!x.startDate&&!x.lesson)list.push("进度未填");const cd=countdownText(x);if(cd&&cd!=="未定时间")list.push(cd);return list.slice(0,2);}

/* Final clean UI pass: earth notebook, readable schedule, compact phrase wall */
function cleanStatusList(x){
  const list=[];
  if(!zoomName(x)) list.push("缺 Zoom");
  if(!x.startDate&&!x.lesson) list.push("缺进度");
  const cd=countdownText(x);
  if(cd&&cd!=="未定时间") list.push(cd);
  return list.slice(0,2);
}

function renderStickers(){
  const list=filterStickersWithSearch(stickerPool(),libraryScene,libraryAudience,librarySearch);
  setHead("话术便签墙","",list.length+" stickers");
  byId("tabs").innerHTML="";
  byId("content").innerHTML=`<div class="phrase-desk clean-phrase"><aside class="phrase-sidebar"><div class="phrase-side-head"><b>找话术</b><button class="btn primary" data-new-sticker type="button">新增</button></div><input class="search-input" id="librarySearch" value="${safeAttr(librarySearch)}" placeholder="搜索 Zoom、作业、迟到、总结"><div class="phrase-group"><b>阶段</b>${tabs([{value:"all",label:"全部"},...SCENES.map(x=>({value:x,label:x==="ai"?"AI提示":SCENE_LABELS[x]}))],libraryScene,"libraryScene")}</div><div class="phrase-group"><b>发给</b>${tabs([{value:"all",label:"全部"},...AUDIENCE_FILTERS.map(x=>({value:x,label:AUDIENCE_LABELS[x]}))],libraryAudience,"libraryAudience")}</div></aside><section class="phrase-wall"><div class="phrase-toolbar"><span>${list.length} 条可用便签</span></div><div class="library-grid compact" id="phraseGrid">${list.map(renderStickerCard).join("")||'<p class="empty">没有匹配的话术。</p>'}</div></section></div>`;
  bindLibraryEvents();bindCopy(list);bindDetail(list);
}

function refreshPhraseGrid(){
  const list=filterStickersWithSearch(stickerPool(),libraryScene,libraryAudience,librarySearch),grid=byId("phraseGrid");
  if(grid){grid.innerHTML=list.map(renderStickerCard).join("")||'<p class="empty">没有匹配的话术。</p>';bindCopy(list);bindDetail(list);}
  byId("counter").textContent=list.length+" stickers";
  const toolbar=document.querySelector(".phrase-toolbar span"); if(toolbar) toolbar.textContent=list.length+" 条可用便签";
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
  byId("content").innerHTML=`<div class="manage-home compact earth-manage-home clean-manage-home"><button class="manage-card" data-manage-go="stickers"><b>整理话术</b><p>按分类搜索、修改、归档常用话术。</p></button><button class="manage-card" data-manage-go="classes"><b>整理课程</b><p>补开课日、Zoom、老师和学生。</p></button><button class="manage-card" data-manage-go="trash"><b>回收站</b><p>恢复误删内容。</p></button><button class="manage-card" data-manage-go="backup"><b>备份资料</b><p>导出或导入全部数据。</p></button></div>
  ${testDataPanelHtml()}`;
  bindTestDataButtons();
}

/* 测试数据面板：管理入口和备份页都放一份，Shirley 上次没找到 */
function testDataPanelHtml(){
  const n=scheduleData.filter(c=>String(c.id).startsWith("test-")).length;
  const ns=studentsData.filter(p=>String(p.id).startsWith("test-")).length;
  return `<section class="panel test-data-box">
    <div class="panel-head"><h3>🧪 测试数据</h3><span>随便玩，一键清掉</span></div>
    <p class="test-data-hint">导入 <b>10 个测试班 + 15 个测试学生</b>（LR/CW/CR/EW、上下半年/假期营/1对1、一个已结课的班，带 6 周点名和作业记录）+ 2 张测试 SOP 卡。都带 <b>"测试·"</b> 前缀，不碰你的真实课程。</p>
    ${n?`<p class="test-data-now">当前有测试数据：${n} 个班、${ns} 个学生。</p>`:""}
    <div class="form-actions">
      <button class="btn primary" id="importTestData" type="button">导入测试数据</button>
      <button class="btn danger" id="clearTestData" type="button" ${n?"":"disabled"}>清除全部测试数据</button>
    </div>
  </section>`;
}

function bindTestDataButtons(){
  const imp=byId("importTestData");
  if(imp)imp.addEventListener("click",()=>{
    if(adminViewEmail){showToast("正在查看他人数据，只能浏览不能修改");return;}
    if(scheduleData.some(c=>String(c.id).startsWith("test-"))){showToast("已经导入过了，先清除再重新导入");return;}
    askConfirm("导入 10 个测试班 + 15 个测试学生？\n它们都叫\"测试·xx\"，会和真实数据一起显示，随时可以一键清除。",()=>{
      importTestData();
      autoCloseFinishedClasses(); // 日期全上完的测试假期营立刻演示自动结课
      showToast("测试数据已导入，去课程页玩玩筛选吧");
      view="courses";render();
    },{danger:false,okText:"导入",icon:"📦"});
  });
  const clr=byId("clearTestData");
  if(clr)clr.addEventListener("click",()=>{
    if(adminViewEmail){showToast("正在查看他人数据，只能浏览不能修改");return;}
    askConfirm("清除所有\"测试·\"开头的班级、学生和 SOP 卡？真实数据不受影响。",()=>{
      scheduleData=scheduleData.filter(c=>!String(c.id).startsWith("test-"));
      studentsData=studentsData.filter(p=>!String(p.id).startsWith("test-"));
      sopData=sopData.filter(r=>!String(r.id).startsWith("test-"));
      saveSchedule();saveStudents();saveSop();
      showToast("测试数据已全部清除");
      render();
    },{okText:"清除"});
  });
}

/* Final week navigation: previous / current / next week */
var finalWeekOffset = 0;
function activeWeekStart(){return weekStart(addDays(new Date(),finalWeekOffset*7));}
function activeWeekLabel(){const start=activeWeekStart(),end=addDays(start,6);return `${dateLabel(start)} - ${dateLabel(end)}`;}
/* Final month header cleanup */
/* Final clean month view: centered month title and no extra subtitle */
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

let recordDateOverride=""; // 课程主页点某天的日期 → 弹窗直接编辑那一天（v20260612b）

function classRecordDate(item){
  return recordDateOverride||item._occurrenceDate||dateKey(new Date());
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

function lessonNotebookText(item){
  return recordNotes(item)||recordMaterials(item)||"";
}

function colorFieldCard(label,value,tone){
  return `<div class="detail-line info-card ${tone||''}"><span>${esc(label)}</span><b>${esc(value||"\u672a\u586b")}</b></div>`;
}

/* Final readable week lesson card */
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
  // 管理员查看他人时，展示对方的待办（只读，不落本地）
  if(adminViewEmail&&adminViewTodos) return adminViewTodos;
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
  if(adminViewEmail){showToast('正在查看他人数据，只能浏览不能修改');return;}
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

function renderTodayDesk(classes){
  const day=todoDate();
  const dayItems=classesOnDate(classes,day);
  const todos=todosForDay(day,dayItems);
  const realToday=dateKey(new Date());
  const upcoming=classes.map(x=>nextClassOccurrence(x)).filter(Boolean)
    .filter(o=>o._occurrenceDate!==realToday) // 今天的课已在"今天课程"里，最近课程只列今天之后，避免重复
    .sort((a,b)=>{
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

/* Final manage cleanup: compact filters, visible notes, course type search. */
var manageClassSearch="";
var manageClassType="all";
var manageClassRecordDate="";
const CLASS_TYPE_FILTERS=[
  {value:"LR",label:"LR"},
  {value:"CW",label:"CW"},
  {value:"CR",label:"CR"},
  {value:"EW",label:"EW"},
  {value:"MV",label:"电影"}
];
// 类别代码 → 显示名（电影用中文，其余就是代码本身）
function catLabel(code){const f=CLASS_TYPE_FILTERS.find(t=>t.value===code);return f?f.label:code;}
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
  if(/\bmv\b|电影|film|movie/.test(text)) return "MV";
  return "";
}

function courseTypeLabel(x){
  const code=courseCode(x);
  return code?catLabel(code):(x.courseType||"未分类");
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
  if(code==="MV") return "plum";
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
  // 写成"6月8日"而不是"6/8"——Shirley：6/8 分不清是六月八号还是八月六号
  return d?`${d.getMonth()+1}月${d.getDate()}日`:(value||"");
}

function classRecordHistoryHtml(x,selectedDate){
  const records=(Array.isArray(x&&x.classRecords)?x.classRecords.slice():[])
    .filter(r=>r.date)
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)))
    .slice(0,10);
  if(!records.length) return `<div class="record-history empty">还没有保存过当天记录。</div>`;
  return `<div class="record-history"><b>已保存记录</b><div class="record-chip-grid">${records.map(r=>`<button class="record-chip ${r.date===selectedDate?'active':''}" type="button" data-load-class-record="${safeAttr(r.date)}"><span>${esc(formatDateShort(r.date))}</span><small>${esc((r.notes||r.materials||"空记录").slice(0,32))}</small></button>`).join("")}</div></div>`;
}

function renderStickerManage(){
  const list=filterStickersWithSearch(stickersData.filter(x=>!x.deletedAt),manageStickerScene,manageStickerAudience,manageStickerSearch);
  const current=stickersData.find(x=>x.id===editingStickerId)||null;
  byId("content").innerHTML=`<div class="manage-layout sticker-manage compact-manage"><section class="list-panel"><div class="panel-head"><h3>找话术</h3><button class="btn primary" data-new-sticker>新增</button></div><input class="search-input" id="manageStickerSearch" value="${safeAttr(manageStickerSearch)}" placeholder="搜索标题、内容或备注"><div class="manage-filter">${filterBar("manageSticker",manageStickerScene,manageStickerAudience)}</div><div class="item-list card-list">${list.map(x=>{const note=(x.note||"").trim();return `<button class="list-item ${x.id===editingStickerId?'active':''}" data-edit-sticker="${safeAttr(x.id)}"><b>${esc(x.title)}</b><span>${SCENE_LABELS[x.scene]} · ${AUDIENCE_LABELS[x.audience]}${x.archivedAt?' · 已归档':''}</span>${note?`<small class="list-note">${esc(note)}</small>`:""}</button>`}).join("")||'<p class="empty">这个分类里没有话术。</p>'}</div></section><section class="edit-panel preview-edit">${stickerForm(current)}</section></div>`;
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
  // "结课/恢复开课"：和课程主页右上角的结课是同一个状态（status=Archived）
  document.querySelectorAll("[data-archive-class]").forEach(b=>b.addEventListener("click",()=>{
    const x=scheduleData.find(c=>c.id===editingClassId);
    if(!x)return;
    if(isClassDone(x)){
      x.status="Active";x.archivedAt="";
      saveSchedule();showToast("已恢复开课，课表上会重新出现");
    }else{
      askConfirm("把「"+x.className+"」结课？\n结课后课表上不再显示，数据都还在，随时可恢复。",()=>{
        x.status="Archived";x.archivedAt=new Date().toISOString();
        saveSchedule();showToast("已结课");
        render();
      },{danger:false,okText:"结课",icon:"🎓"});
      return;
    }
    render();
  }));
  document.querySelectorAll("[data-delete-class]").forEach(b=>b.addEventListener("click",()=>{const x=scheduleData.find(c=>c.id===editingClassId);if(x){x.status="Deleted";x.deletedAt=new Date().toISOString();editingClassId=null;saveSchedule();render();}}));
  document.querySelectorAll("[data-restore-sticker]").forEach(b=>b.addEventListener("click",()=>{const x=stickersData.find(s=>s.id===b.dataset.restoreSticker);if(x){x.deletedAt="";saveStickers();render();}}));
  document.querySelectorAll("[data-purge-sticker]").forEach(b=>b.addEventListener("click",()=>askConfirm("确定彻底删除这条话术吗？",()=>{stickersData=stickersData.filter(s=>s.id!==b.dataset.purgeSticker);saveStickers();render();},{okText:"彻底删除"})));
  document.querySelectorAll("[data-restore-class]").forEach(b=>b.addEventListener("click",()=>{const x=scheduleData.find(c=>c.id===b.dataset.restoreClass);if(x){x.status="Active";x.deletedAt="";saveSchedule();render();}}));
  document.querySelectorAll("[data-purge-class]").forEach(b=>b.addEventListener("click",()=>askConfirm("确定彻底删除这节课吗？",()=>{scheduleData=scheduleData.filter(c=>c.id!==b.dataset.purgeClass);saveSchedule();render();},{okText:"彻底删除"})));
  document.querySelectorAll("[data-export-all]").forEach(b=>b.addEventListener("click",()=>{byId("backupText").value=JSON.stringify({stickers:stickersData,classes:scheduleData,stickerCategories,courseCategories},null,2);showToast("已导出");}));
  document.querySelectorAll("[data-import-all]").forEach(b=>b.addEventListener("click",importAll));
}

/* Final usability pass: compact editing, direct course edits, and cleaner schedule controls. */
function finalTermOptions(){
  return ["上半年","下半年","假期营","1对1"];
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

function classDetailText(item){
  return `老师：${item.teacher||"未填"}\n学生：${item.students.map(s=>s.name).join("、")||"暂无"}\n课程：${item.courseType||"未填"}\n进度：${lessonLabel(item)}\n主题：${item.topic||"未填"}\n学期：${classTermLabel(item)}\nZoom账号：${zoomName(item)||"未填"}\n\n课程笔记：${lessonNotebookText(item)||"未填"}`;
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
        <label class="field">分类<select id="classCourseType">${CLASS_TYPE_FILTERS.map(t=>`<option value="${t.value}" ${code===t.value?'selected':''}>${t.label}</option>`).join("")}</select></label>
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
  <div class="form-actions"><button class="btn primary" data-save-class>保存</button>${x.id?`<button class="btn ghost" data-archive-class>${isClassDone(x)?"恢复开课":"结课"}</button><button class="btn danger" data-delete-class>删除</button>`:''}</div>
  ${x.id&&isClassDone(x)?'<p class="form-hint done-hint">这个班已结课：课表上不显示，课程页点"含已结课"能看到它的全部数据。</p>':''}`;
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

/* 导航按钮由 JS 生成（v20260611f）：以后加页面只改这份列表，
   不依赖 index.html 更新——避免 Shirley 那边 HTML 被浏览器缓存导致看不到新导航 */
const NAV_ITEMS=[
  {view:"today",label:"日程",sub:"本周课表"},
  {view:"stickers",label:"话术",sub:"快速复制"},
  {view:"courses",label:"课程",sub:"总览与对比"},
  {view:"students",label:"学生",sub:"名册与关联"},
  {view:"teachers",label:"老师",sub:"面板·欠交追踪"},
  {view:"sop",label:"SOP",sub:"做事流程"},
  {view:"manage",label:"管理",sub:"整理与备份"}
];
(function renderMainNav(){
  const nav=document.querySelector(".main-nav");
  if(!nav)return;
  nav.innerHTML=NAV_ITEMS.map(n=>`<button class="nav-btn ${view===n.view?'active':''}" data-view="${n.view}" type="button"><span>${n.label}</span><small>${n.sub}</small></button>`).join("");
  nav.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{view=btn.dataset.view;render();}));
})();
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
      <label class="field">分类<select id="modalType">${CLASS_TYPE_FILTERS.map(t=>`<option value="${t.value}" ${code===t.value?'selected':''}>${t.label}</option>`).join("")}</select></label>
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
// Fix 2: openClassDetailModal — style.display toggle, hide copy button
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
/* ============================================================
   REMOVE QUICK PHRASES + CLEAN classDetailHtml
   ============================================================ */
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
  // 本节课点名（二期）+ 作业（三期）+ 课程主页入口
  bindAttendanceSection(item);
  bindHomeworkSection(item);
  const homeBtn=byId("detailCourseHome");
  if(homeBtn){
    homeBtn.hidden=isDemo;
    homeBtn.onclick=()=>{closeStickerDetail();openCourseHome(item.id);};
  }
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
  const dayText=`${todayName(daysBetween(d,new Date()))} ${(d.getMonth()+1)}月${d.getDate()}日`;
  // 每张卡结构完全一致：日期块 / 时间 / 课名 / 老师人数（各占一行，长名只在自己那行换行，不影响对齐）
  return `<button class="recent-course-card ${courseTone(x)}" data-schedule-id="${safeAttr(x.id)}" data-occurrence-date="${safeAttr(occ._occurrenceDate||"")}" type="button">
    <span class="recent-date">${esc(dayText)}</span>
    <span class="recent-time">${esc(formatTimeCN(x.time))}</span>
    <b class="recent-cls-name">${esc(x.className)}</b>
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
  const studentsHtml=item.students.length?item.students.map(s=>`<button class="student-link" data-student-name="${safeAttr(s.name)}" type="button">${esc(s.name)}</button>`).join(""):"暂无";
  // 排期信息（v20260612d）：当天点开也能看到开课/结课/休息日和当天第几堂
  const sched=courseScheduleInfo(item);
  const skips=skippedDates(item).slice().sort();
  const skipNote=skips.length?`休息 ${skips.slice(0,5).map(formatDateShort).join("、")}${skips.length>5?` 等${skips.length}天`:""}`:"无停课日";
  // 当天进度：按这一天算"第几堂"，而不是课程的笼统进度
  const occDate=parseLocalDate(date);
  const todayLesson=(occDate?occurrenceInfo(item,occDate).lesson:"")||lessonLabel(item);
  const schedLine=sched
    ?`<div class="detail-line wide detail-sched-line"><span>开课 → 结课 · 休息日</span><b>${esc(formatDateShort(sched.first))} → ${esc(formatDateShort(sched.last))}　·　${esc(skipNote)}</b></div>`
    :`<div class="detail-line wide detail-sched-line"><span>开课 → 结课 · 休息日</span><b class="muted-fill">还没填排期（去管理页编辑里填开课日期或指定上课日期）</b></div>`;
  return `<div class="detail-section"><h4>上课信息</h4><div class="detail-grid final-detail-grid">${fieldCard("老师",item.teacher)}${fieldCard("课程",item.courseType)}${fieldCard("当天进度",todayLesson)}${fieldCard("主题",item.topic)}${fieldCard("学期",classTermLabel(item))}${fieldCard("Zoom",zoomName(item))}${schedLine}<div class="detail-line wide"><span>学生 · ${item.students.length} 位（点名字看名册）</span><b class="student-links">${studentsHtml}</b></div></div></div>${attendanceSectionHtml(item,date)}${homeworkSectionHtml(item,date)}<div class="detail-section detail-note-section"><div class="note-section-head"><h4>${formatDateShort(date)} 课堂笔记</h4>${merged.length?`<button class="btn ghost detail-history-toggle" id="detailHistoryToggle" type="button">历史 (${merged.length})</button>`:""}</div>${todayTodosHtml}<textarea id="detailNoteInput" class="detail-note-input" placeholder="今天发生了什么？只属于这一天。">${esc(todayNote)}</textarea><button class="btn note-save-btn" id="detailNoteSave" type="button">保存笔记</button></div>${merged.length?`<div class="detail-history-section" id="detailHistory" style="display:none">${historyHtml}</div>`:""}`;
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
  listEl.innerHTML=list.map(x=>`<button class="list-item course-list-item ${x.id===editingClassId?'active':''}" data-edit-class="${safeAttr(x.id)}"><b>${esc(x.weekday)} ${esc(formatTimeCN(x.time)||"未定")} · ${esc(x.className)}${isClassDone(x)?'<i class="ov-done-tag">已结课</i>':''}</b><span>${esc(courseTypeLabel(x))} · ${esc(x.teacher||"未填老师")} · ${esc(x.term||classTermLabel(x))}</span></button>`).join("")||'<p class="empty">没找到。</p>';
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
  if(adminViewEmail){showToast('正在查看他人数据，只能浏览不能修改');return;}
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
    if(adminViewEmail){showToast('正在查看他人数据，只能浏览不能修改');return;}
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
    if(adminViewEmail){showToast('正在查看他人数据，只能浏览不能修改');return;}
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

/* ===== 学生管理 一期（v20260611a）=====
   学生档案独立存储在 studentsData（云端 user_data.students 列）。
   课程↔学生按"姓名"关联：课程里填的学生名要与档案姓名一致。
   名册 = 已建档案 ∪ 课程里出现过的名字（没建档的标"未建档"）。 */
let studentSearch="";
let studentStatusFilter="all";   // all | 在读 | 停课 | 结课 | 未建档
let editingStudentName=null;
let studentDetailEditing=false;  // 详情默认"查看"，点"编辑档案"才展开表单
let studentLinkPickerOpen=false; // "＋ 关联课程"选课列表是否展开
let studentSortDir="desc";       // 找学生排序：desc=年龄大→小，asc=小→大
// 学生页镜像课程总览的筛选（v20260614c）：类别×学期×时间
let studentCatType="all";        // all | LR | CW | CR | EW | MV | 其他
let studentTermFilter="all";     // all | 上半年 | 下半年 | 假期营 | 1对1 | 结课
let studentRange=null;           // null=默认本周；{from,to}=用户选过（{from:"",to:""}=全部时间）

const STUDENT_STATUSES=["在读","停课","结课"];

function normalizeStudentProfile(p){
  p=p||{};
  return {
    id:p.id||uid("stu"),
    name:(p.name||"").trim()||"未命名学生",
    gender:["男","女"].includes(p.gender)?p.gender:"",
    birthday:p.birthday||"",
    grade:p.grade||"",
    school:p.school||"",
    city:p.city||"",
    parentName:p.parentName||"",
    parentContact:p.parentContact||"",
    enrollDate:p.enrollDate||"",
    // 这里不能用 STUDENT_STATUSES 常量：本函数在文件顶部 loadCollection 时就会被调用，
    // 而 const 声明在下面，会报"before initialization"导致本地缓存的学生档案读不出来
    status:["在读","停课","结课"].includes(p.status)?p.status:"在读",
    note:p.note||"",
    // 作业欠交跟进记录（v20260614b，老师面板黑榜用）：[{id,date,action,parentReply,result,status,loggedAt}]
    // 存在学生档案里，跟着 students jsonb 列上云，不用改数据库
    followups:Array.isArray(p.followups)?p.followups:[],
    createdAt:p.createdAt||new Date().toISOString(),
    updatedAt:p.updatedAt||new Date().toISOString()
  };
}

function saveStudents(){
  if(adminViewEmail)return; // 查看他人时只读
  localStorage.setItem(STORAGE_KEYS.students,JSON.stringify(studentsData));
  syncToCloud();
}

function studentRoster(){
  const map={};
  studentsData.forEach(p=>{map[p.name]={name:p.name,profile:p,classes:[],classNotes:[]};});
  scheduleData.filter(c=>c.status!=="Deleted"&&!c.deletedAt).forEach(c=>{
    (c.students||[]).forEach(s=>{
      const name=(s.name||"").trim();
      if(!name)return;
      if(!map[name])map[name]={name:name,profile:null,classes:[],classNotes:[]};
      map[name].classes.push(c);
      if(s.note&&!map[name].classNotes.includes(s.note))map[name].classNotes.push(s.note);
    });
  });
  return Object.values(map).sort((a,b)=>a.name.localeCompare(b.name,"zh-Hans-CN"));
}

function studentStatusLabel(r){return r.profile?r.profile.status:"未建档";}
function studentStatusClass(st){return st==="在读"?"stu-active":st==="停课"?"stu-pause":st==="结课"?"stu-done":"stu-none";}

function filteredRoster(){
  const kw=studentSearch.trim().toLowerCase();
  const codeOf=c=>courseCode(c)||"其他";
  const termIsDone=studentTermFilter==="结课";
  return studentRoster().filter(r=>{
    if(studentStatusFilter!=="all"&&studentStatusLabel(r)!==studentStatusFilter)return false;
    // 类别：TA 报的课里有任一门是该类别（一个孩子可同时出现在 CW/LR/电影 多个筛选下）
    if(studentCatType!=="all"&&!r.classes.some(c=>codeOf(c)===studentCatType))return false;
    // 学期：TA 报的课里有任一门是该学期；选"结课"=有已结课的课
    if(studentTermFilter!=="all"&&!r.classes.some(c=>termIsDone?isClassDone(c):classTermLabel(c)===studentTermFilter))return false;
    if(!kw)return true;
    const p=r.profile;
    const hay=(r.name+" "+(p?[p.school,p.city,p.grade,p.parentName].join(" "):"")).toLowerCase();
    return hay.includes(kw);
  });
}

/* 一组学生在某时间范围内的出勤/作业汇总（学生页顶部汇总用）。按人次统计（一个孩子多门课各算）。 */
function rosterRangeStats(names,since,until){
  const set=names instanceof Set?names:new Set(names);
  const s={att:0,abs:0,hwAssigned:0,hwIn:0};
  overviewCourses().forEach(c=>{
    (Array.isArray(c.classRecords)?c.classRecords:[]).forEach(rec=>{
      const d=String(rec.date||"");
      if((since&&d<since)||(until&&d>until))return;
      const hw=rec.homework||{};
      const hwOn=homeworkAssigned(hw);
      const rollTaken=Object.keys(rec.attendance||{}).some(n=>normalizeAttendanceEntry(rec.attendance[n]).status);
      (c.students||[]).forEach(st=>{
        const name=(st.name||"").trim();
        if(!name||!set.has(name))return;
        const a=normalizeAttendanceEntry((rec.attendance||{})[name]);
        if(a.status==="到")s.att++;
        if(a.status==="缺席")s.abs++;
        if(hwOn&&(!rollTaken||a.status==="到")){
          s.hwAssigned++;
          const e=(hw.entries||{})[name]||{};
          if(e.state==="已交"||e.state==="已批改")s.hwIn++;
        }
      });
    });
  });
  s.attRate=(s.att+s.abs)?Math.round(s.att/(s.att+s.abs)*100):null;
  s.hwRate=s.hwAssigned?Math.round(s.hwIn/s.hwAssigned*100):null;
  return s;
}

function studentListHtml(){
  // 按年龄排（没填生日的永远排最后，再按名字）；方向由 studentSortDir 切换
  const dir=studentSortDir==="asc"?1:-1;
  const list=filteredRoster().slice().sort((a,b)=>{
    const ageA=studentAgeNum(a.profile),ageB=studentAgeNum(b.profile);
    if(ageA===null&&ageB===null)return a.name.localeCompare(b.name,"zh-Hans-CN");
    if(ageA===null)return 1;
    if(ageB===null)return -1;
    return (ageA-ageB)*dir;
  });
  return list.map(r=>{
    const st=studentStatusLabel(r);
    const p=r.profile;
    const age=studentAgeNum(p);
    // 第二行只放最关键的：几门课 · 状态 · 年级（有就显示），学校太长就不挤进来
    const grade=p&&p.grade?` · ${esc(p.grade)}`:"";
    return `<button class="list-item student-list-item ${r.name===editingStudentName?'active':''}" data-pick-student="${safeAttr(r.name)}">
      <div class="stu-li-top"><b>${esc(r.name)}</b>${age!==null?`<i class="stu-li-age">${age}岁</i>`:'<i class="stu-li-age stu-li-age-none">—</i>'}</div>
      <span>${r.classes.length} 门课 · <i class="stu-status ${studentStatusClass(st)}">${st}</i>${grade}</span>
    </button>`;
  }).join("")||'<p class="empty">没找到学生。课程里填过的学生名会自动出现在这里。</p>';
}

/* 年龄数字（用于排序）：没生日/无效返回 null */
function studentAgeNum(p){
  if(!p||!p.birthday)return null;
  const b=parseLocalDate(p.birthday);
  if(!b)return null;
  const now=new Date();
  let age=now.getFullYear()-b.getFullYear();
  if(now.getMonth()<b.getMonth()||(now.getMonth()===b.getMonth()&&now.getDate()<b.getDate()))age--;
  return (age>=0&&age<120)?age:null;
}
function studentAgeText(p){const a=studentAgeNum(p);return a===null?"":a+" 岁";}

/* 入学到今天多少天（v20260612d，Shirley：入学日期旁要显示加入了多少天） */
function enrollDaysText(p){
  if(!p||!p.enrollDate)return "";
  const d=parseLocalDate(p.enrollDate);
  if(!d)return "";
  const days=Math.floor((new Date().setHours(0,0,0,0)-d.getTime())/86400000);
  if(days<0)return "还没入学";
  if(days===0)return "今天入学";
  if(days<30)return `已加入 ${days} 天`;
  if(days<365)return `已加入 ${days} 天（约 ${Math.floor(days/30)} 个月）`;
  const y=Math.floor(days/365),rem=Math.floor((days%365)/30);
  return `已加入 ${days} 天（约 ${y} 年${rem?" "+rem+" 个月":""}）`;
}

function studentViewHtml(p){
  const tile=(label,value,tone)=>`<div class="stu-tile ${tone}${value?"":" no-val"}"><span>${esc(label)}</span><b>${esc(value||"未填")}</b></div>`;
  const ageText=studentAgeText(p);
  const enrollDays=enrollDaysText(p);
  const enrollTile=`<div class="stu-tile t-green${p.enrollDate?"":" no-val"}"><span>入学日期</span><b>${esc(p.enrollDate||"未填")}</b>${enrollDays?`<small class="ov-tile-detail">${esc(enrollDays)}</small>`:""}</div>`;
  return `<div class="stu-info-grid">
    ${tile("性别",p.gender,"t-blue")}
    ${tile("年龄",ageText?`${ageText}（${formatDateShort(p.birthday)} 生日）`:"","t-green")}
    ${tile("年级/级别",p.grade,"t-yellow")}
    ${tile("学校",p.school,"t-green")}
    ${tile("城市",p.city,"t-blue")}
    ${tile("家长称呼",p.parentName,"t-yellow")}
    ${tile("家长联系",p.parentContact,"t-blue")}
    ${enrollTile}
  </div>
  ${p.note?`<div class="stu-note-card"><span>备注</span><p>${esc(p.note)}</p></div>`:""}`;
}

function studentFormHtml(p,isNew){
  return `<div class="form-grid student-form">
    <label class="field">姓名<input id="stuName" value="${safeAttr(p.name)}" placeholder="要和课程里填的名字一致"></label>
    <label class="field">性别<select id="stuGender">${["","男","女"].map(g=>`<option value="${g}" ${p.gender===g?'selected':''}>${g||"未填"}</option>`).join("")}</select></label>
    <label class="field">生日（用来自动算年龄）<input id="stuBirthday" type="date" value="${safeAttr(p.birthday)}"></label>
    <label class="field">年级/级别<input id="stuGrade" value="${safeAttr(p.grade)}" placeholder="如 五年级 / LR-3"></label>
    <label class="field">学校<input id="stuSchool" value="${safeAttr(p.school)}"></label>
    <label class="field">城市<input id="stuCity" value="${safeAttr(p.city)}"></label>
    <label class="field">家长称呼<input id="stuParent" value="${safeAttr(p.parentName)}" placeholder="如 Miki妈妈"></label>
    <label class="field">家长联系<input id="stuContact" value="${safeAttr(p.parentContact)}" placeholder="微信/电话"></label>
    <label class="field">入学日期<input id="stuEnroll" type="date" value="${safeAttr(p.enrollDate)}"></label>
    <label class="field">状态<select id="stuStatus">${STUDENT_STATUSES.map(s=>`<option value="${s}" ${p.status===s?'selected':''}>${s}</option>`).join("")}</select></label>
    <label class="field full">备注<textarea id="stuNote" placeholder="性格、注意事项、学习习惯…">${esc(p.note)}</textarea></label>
  </div>
  <div class="form-actions">
    <button class="btn primary" data-save-student="${safeAttr(isNew?"":p.id)}">保存档案</button>
    ${isNew?"":`<button class="btn" data-cancel-student-edit type="button">取消</button>`}
    ${isNew?"":`<button class="btn danger" data-delete-student="${safeAttr(p.id)}">删除档案</button>`}
  </div>`;
}

/* 课堂时间线 v2（v20260611f）：可按课程筛、只看缺席/只看作业；
   长表现默认折叠两行，点一下展开；日期/出勤/作业/课程名分组清晰 */
let stuTimelineCourse="all"; // all | 课程id
let stuTimelineKind="all";   // all | absent | homework

function studentTimelineHtml(name,classes){
  const entries=[];
  classes.forEach(c=>{(Array.isArray(c.classRecords)?c.classRecords:[]).forEach(rec=>{
    const n=normalizeAttendanceEntry((rec.attendance||{})[name]);
    const hw=rec.homework||{};
    const assigned=homeworkAssigned(hw);
    const he=assigned?((hw.entries||{})[name]||{}):null;
    const hwState=assigned?(HOMEWORK_STATES.includes(he.state)?he.state:"未交"):"";
    if(!n.status&&!n.tag&&!n.remark&&!assigned)return;
    entries.push({date:rec.date||"",cls:c,...n,hwState,hwScore:(he&&he.score)||""});
  });});
  if(!entries.length)return `<h4>课堂时间线</h4><p class="empty">还没有记录：上课时在课程详情里点名、记作业，会自动出现在这里。</p>`;
  entries.sort((a,b)=>b.date.localeCompare(a.date));
  // 课程筛选（上多门课时才出现）
  const courseIds=[...new Set(entries.map(e=>e.cls.id))];
  if(stuTimelineCourse!=="all"&&!courseIds.includes(stuTimelineCourse))stuTimelineCourse="all";
  const byCourse=stuTimelineCourse==="all"?entries:entries.filter(e=>e.cls.id===stuTimelineCourse);
  // 统计行跟着课程筛选走（想看单门课的表现）
  const stat={};byCourse.forEach(e=>{if(e.status)stat[e.status]=(stat[e.status]||0)+1;});
  const extraStat={};byCourse.forEach(e=>{if(e.tag)extraStat[e.tag]=(extraStat[e.tag]||0)+1;});
  const hwAssigned=byCourse.filter(e=>e.hwState).length;
  const hwDone=byCourse.filter(e=>e.hwState==="已交"||e.hwState==="已批改").length;
  const statLine=ATTENDANCE_MAIN.filter(s=>stat[s]).map(s=>`<i class="att-chip ${attendanceStatusClass(s)}">${s} ${stat[s]}</i>`).join("")
    +(hwAssigned?`<i class="att-chip hw-chip">作业 ${hwDone}/${hwAssigned}</i>`:"");
  const extraLine=ATTENDANCE_EXTRA.filter(t=>extraStat[t]).map(t=>`${t} ${extraStat[t]}`).join(" · ");
  // 只看：到/缺席/迟到/请假/作业已交/作业未交/有评语 都能单独筛（Shirley：只有缺席和作业太局限）
  const shown=byCourse.filter(e=>{
    switch(stuTimelineKind){
      case "到":return e.status==="到";
      case "缺席":return e.status==="缺席";
      case "迟到":return e.tag==="迟到";
      case "请假":return e.tag==="请假";
      case "hw-in":return e.hwState==="已交"||e.hwState==="已批改";
      case "hw-none":return e.hwState==="未交";
      case "remark":return !!e.remark;
      case "absent":return e.status==="缺席"||e.tag==="请假"; // 旧值兼容
      case "homework":return !!e.hwState;
      default:return true;
    }
  });
  const courseChips=courseIds.length>1?`<div class="stu-tl-filter-row"><span class="ov-filter-label">课程</span><div class="ov-filter-chips">${[["all","全部"],...courseIds.map(id=>{const c=classes.find(x=>x.id===id);return [id,c?c.className:id];})].map(([v,l])=>`<button class="tab ${stuTimelineCourse===v?'active':''}" data-stu-tl-course="${safeAttr(v)}" type="button">${esc(l)}</button>`).join("")}</div></div>`:"";
  const kindChips=`<div class="stu-tl-filter-row"><span class="ov-filter-label">只看</span><div class="ov-filter-chips">${[["all","全部"],["到","到"],["缺席","缺席"],["hw-in","作业已交"],["hw-none","作业未交"]].map(([v,l])=>`<button class="tab ${stuTimelineKind===v?'active':''}" data-stu-tl-kind="${safeAttr(v)}" type="button">${l}</button>`).join("")}</div></div>`;
  const entryHtml=e=>{
    const long=(e.remark||"").length>64;
    return `<div class="stu-tl-card">
      <div class="stu-tl-top">
        <span class="stu-tl-date">${esc(formatDateShort(e.date))}</span>
        <span class="stu-tl-classtag">${esc(e.cls.className)}</span>
        <span class="stu-tl-chips">
          ${e.status?`<i class="att-chip ${attendanceStatusClass(e.status)}">${esc(e.status)}</i>`:""}
          ${e.tag?`<i class="att-chip att-tag-chip ${attendanceStatusClass(e.tag)}">${esc(e.tag)}</i>`:""}
          ${e.hwState?`<i class="att-chip hw-chip ${hwStateClass(e.hwState)}">📚${esc(e.hwState)}${e.hwScore?` ${esc(e.hwScore)}`:""}</i>`:""}
        </span>
      </div>
      ${e.remark?`<div class="stu-tl-remark-wrap${long?' clampable':''}"><div class="stu-tl-remark2${long?' clamped':''}">${esc(e.remark)}</div>${long?'<span class="tl-expand-hint">▾ 点开看全部</span>':""}</div>`:""}
    </div>`;
  };
  return `<h4 class="stu-tl-head">课堂时间线${statLine?`<span class="stu-tl-stats">${statLine}</span>`:""}${extraLine?`<small class="stu-tl-extra-stat">（${extraLine}）</small>`:""}</h4>
  <div class="stu-tl-filterbar">${courseChips}${kindChips}</div>
  <div class="stu-timeline stu-timeline2">${shown.slice(0,30).map(entryHtml).join("")||'<p class="empty">这个筛选下没有记录。</p>'}</div>
  ${shown.length>30?`<p class="student-phase-hint">只显示最近 30 条。</p>`:""}`;
}

/* 点筛选只重画时间线这一块，页面其他部分一动不动——滚动位置自然不会跳
   （v20260612c，Shirley：点缺席/作业筛选还是会回跳，rerenderKeepScroll 治标不治本） */
function refreshStudentTimeline(){
  const block=byId("stuTlBlock");
  if(!block||view!=="students"||!editingStudentName){rerenderKeepScroll();return;}
  const r=studentRoster().find(x=>x.name===editingStudentName);
  block.innerHTML=studentTimelineHtml(editingStudentName,r?r.classes:[]);
}

/* 点名/作业栏折叠（事件委托）：点"收起"把这一栏内容藏起来，页面不会拉太长 */
document.addEventListener("click",function(e){
  const cb=e.target.closest&&e.target.closest("[data-sec-collapse]");
  if(cb){
    const sec=cb.closest(".attendance-section");
    if(sec){const now=sec.classList.toggle("collapsed");cb.textContent=now?"展开 ▸":"收起 ▾";}
    return;
  }
});

/* 时间线筛选 + 长文本展开（事件委托，整页重渲染也不丢） */
document.addEventListener("click",function(e){
  const courseBtn=e.target.closest&&e.target.closest("[data-stu-tl-course]");
  if(courseBtn){stuTimelineCourse=courseBtn.dataset.stuTlCourse;refreshStudentTimeline();return;}
  const kindBtn=e.target.closest&&e.target.closest("[data-stu-tl-kind]");
  if(kindBtn){stuTimelineKind=kindBtn.dataset.stuTlKind;refreshStudentTimeline();return;}
  const wrap=e.target.closest&&e.target.closest(".stu-tl-remark-wrap.clampable");
  if(wrap){
    const body=wrap.querySelector(".stu-tl-remark2");
    const hint=wrap.querySelector(".tl-expand-hint");
    const nowClamped=body.classList.toggle("clamped");
    if(hint)hint.textContent=nowClamped?"▾ 点开看全部":"▴ 收起";
  }
});

/* "＋ 关联课程"：列出 TA 还没在的课程，点一下就把名字写进那门课的学生栏（v20260611f） */
function studentLinkPickerHtml(){
  const linkable=overviewCourses().filter(c=>!(c.students||[]).some(s=>(s.name||"").trim()===editingStudentName));
  if(!linkable.length)return `<div class="link-course-picker"><p class="empty">所有课程都已关联 TA 了。</p></div>`;
  return `<div class="link-course-picker">
    <p class="link-picker-hint">点一门课，就会把「${esc(editingStudentName)}」写进它的学生栏（和课程编辑页填名字是同一回事）：</p>
    <div class="link-course-list">${linkable.map(c=>`<button class="link-course-option" data-link-course="${safeAttr(c.id)}" type="button"><b>${esc(c.className)}</b><small>${esc(c.weekday)} ${esc(formatTimeCN(c.time))} · ${esc(c.teacher||"未填老师")} · ${esc(classTermLabel(c))}</small></button>`).join("")}</div>
  </div>`;
}

function studentDetailHtml(){
  if(!editingStudentName)return studentBoardHtml();
  const r=studentRoster().find(x=>x.name===editingStudentName);
  const p=r&&r.profile?r.profile:normalizeStudentProfile({name:editingStudentName});
  const isNew=!(r&&r.profile);
  const classes=r?r.classes:[];
  const classNotes=r?r.classNotes:[];
  const showForm=isNew||studentDetailEditing;
  return `<button class="btn ghost stu-back-btn" data-stu-back type="button">← 返回黑榜 / 名册</button>
  <div class="stu-view-head">
    <div>
      <h3 class="student-detail-title">${esc(editingStudentName)} ${isNew?'<i class="stu-status stu-none">未建档 · 保存一次即建档</i>':`<i class="stu-status ${studentStatusClass(p.status)}">${esc(p.status)}</i>`}</h3>
      <p class="stu-view-sub">${classes.length} 门课${p.enrollDate&&!isNew?` · ${esc(formatDateShort(p.enrollDate))} 入学`:""}${p.grade&&!isNew?` · ${esc(p.grade)}`:""}</p>
    </div>
    ${showForm?"":'<button class="btn" data-edit-student type="button">✏️ 编辑档案</button>'}
  </div>
  ${showForm?studentFormHtml(p,isNew):studentViewHtml(p)}
  <div class="student-detail-extra">
    <div class="stu-classes-head"><h4>TA 的课程（${classes.length}）</h4><button class="btn ghost stu-link-toggle" data-link-course-toggle type="button">${studentLinkPickerOpen?"收起":"＋ 关联课程"}</button></div>
    <div class="student-classes">${classes.map(c=>`<span class="student-class-item"><button class="student-class-chip${c.archivedAt?' archived':''}" data-stu-open-course="${safeAttr(c.id)}" type="button" title="进这门课的课程主页">${esc(c.weekday)} ${esc(formatTimeCN(c.time))} · ${esc(c.className)}${c.archivedAt?'（已结课）':''}</button><button class="stu-unlink-btn" data-unlink-course="${safeAttr(c.id)}" type="button" title="把 TA 从这门课的学生栏移除">✕</button></span>`).join("")||'<p class="empty">还没关联课程：点右上"＋ 关联课程"，或去课程编辑页把 TA 的名字填进"学生"栏。</p>'}</div>
    ${studentLinkPickerOpen?studentLinkPickerHtml():""}
    ${classNotes.length?`<h4>课程"学生"栏里的小备注</h4><p class="student-note">📝 ${esc(classNotes.join("；"))}<small class="student-note-hint">（在课程编辑页"学生"栏用"姓名 | 备注"的写法写的，会显示在这里）</small></p>`:""}
    ${studentFollowupSectionHtml(editingStudentName)}
    <div id="stuTlBlock">${studentTimelineHtml(editingStudentName,classes)}</div>
  </div>`;
}

function renderStudents(){
  const def=quickRange("week");
  const since=studentRange?studentRange.from:def[0];
  const until=studentRange?studentRange.to:def[1];
  const rt=rangeText(since,until);
  const roster=filteredRoster();
  const names=new Set(roster.map(r=>r.name));
  const st=rosterRangeStats(names,since,until);
  // 欠交人数 / 待跟进人数（当前筛选 + 时间范围内）
  const owed=homeworkOwedInRange(since,until,"").owed;
  const owedFiltered=Object.keys(owed).filter(n=>names.has(n));
  const todoCount=owedFiltered.filter(n=>!studentFollowups(n).some(f=>!since||String(f.date)>=since)).length;
  const codeOf=c=>courseCode(c)||"其他";
  const cats=["LR","CW","CR","EW","MV"];
  if(studentRoster().some(r=>r.classes.some(c=>codeOf(c)==="其他")))cats.push("其他");
  const chip=(cur,val,label,key)=>`<button class="tab ${cur===val?'active':''}" data-${key}="${safeAttr(val)}" type="button">${esc(label)}</button>`;
  setHead("学生","","共 "+roster.length+" 人");
  byId("tabs").innerHTML="";
  byId("content").innerHTML=`<div class="course-home course-overview student-overview">
    <div class="ov-toolbar">
      <span class="ov-group"><i>类别</i>${chip(studentCatType,"all","全部","stu-type")}${cats.map(t=>chip(studentCatType,t,catLabel(t),"stu-type")).join("")}</span>
      <span class="ov-group"><i>学期</i>${chip(studentTermFilter,"all","全部","stu-term")}${TERM_OPTIONS.map(t=>chip(studentTermFilter,t,t,"stu-term")).join("")}${chip(studentTermFilter,"结课","结课","stu-term")}</span>
      <span class="ov-group ov-group-time"><i>时间</i>${dateRangeCtlHtml("st",since,until)}</span>
    </div>
    <div class="stu-info-grid course-home-stats ov-stats">
      <div class="stu-tile t-blue"><span>学生数</span><b>${roster.length} 人</b><small class="ov-tile-detail">共 ${studentRoster().length} 人 · 同名只算一次</small></div>
      ${rateTile("出席率 · "+rt,st.attRate,st.attRate===null?"":`到 ${st.att} / 缺 ${st.abs}`)}
      ${rateTile("交作业率 · "+rt,st.hwRate,st.hwRate===null?"这段时间没布置过":`交 ${st.hwIn} / 应交 ${st.hwAssigned}`)}
      <div class="stu-tile ${owedFiltered.length?'t-pink':'no-val'}"><span>欠交学生 · ${esc(rt)}</span><b>${owedFiltered.length} 人</b><small class="ov-tile-detail">${todoCount?`🔴 ${todoCount} 人待跟进`:(owedFiltered.length?"都跟进过了":"没有欠交")}</small></div>
    </div>
    <div class="manage-layout student-manage">
      <section class="list-panel">
        <div class="panel-head"><h3>找学生</h3><button class="stu-sort-btn" id="studentSortToggle" type="button" title="点击切换年龄排序方向">年龄 ${studentSortDir==="desc"?"大 → 小 ↓":"小 → 大 ↑"}</button></div>
        <div class="filter-line compact-filter stu-status-line">${[["all","全部"],["在读","在读"],["停课","停课"],["结课","结课"],["未建档","未建档"]].map(([v,l])=>`<button class="tab ${studentStatusFilter===v?'active':''}" data-student-status="${safeAttr(v)}">${l}</button>`).join("")}</div>
        <input class="search-input" id="studentSearch" value="${safeAttr(studentSearch)}" placeholder="搜名字、学校、城市、家长…">
        <div class="item-list card-list student-list">${studentListHtml()}</div>
      </section>
      <section class="edit-panel student-detail">${studentDetailHtml()}</section>
    </div>
  </div>`;
  bindStudentEvents();
  document.querySelectorAll("[data-stu-type]").forEach(b=>b.addEventListener("click",()=>{studentCatType=b.dataset.stuType;rerenderKeepScroll();}));
  document.querySelectorAll("[data-stu-term]").forEach(b=>b.addEventListener("click",()=>{studentTermFilter=b.dataset.stuTerm;rerenderKeepScroll();}));
  bindDateRangeCtl("st",(f,t)=>{studentRange={from:f,to:t};rerenderKeepScroll();});
  // 学生页点课程 chip → 进那门课的课程主页（Shirley：之前弹"当天"的详情弹窗，看不懂为什么是 6/12）
  document.querySelectorAll("[data-stu-open-course]").forEach(b=>b.addEventListener("click",()=>openCourseHome(b.dataset.stuOpenCourse)));
  // 返回黑榜/名册（取消选中学生，右面板回到落地黑榜）
  const back=document.querySelector("[data-stu-back]");
  if(back)back.addEventListener("click",()=>{editingStudentName=null;followupFormFor="";render();});
}

function refreshStudentList(){
  const listEl=document.querySelector(".student-list");
  if(!listEl)return;
  listEl.innerHTML=studentListHtml();
  bindStudentPicks();
}

function bindStudentPicks(){
  document.querySelectorAll("[data-pick-student]").forEach(b=>b.addEventListener("click",()=>{editingStudentName=b.dataset.pickStudent;studentDetailEditing=false;stuTimelineCourse="all";stuTimelineKind="all";studentLinkPickerOpen=false;followupFormFor="";render();}));
}

function bindStudentEvents(){
  bindStudentPicks();
  bindFollowupControls();
  document.querySelectorAll("[data-student-status]").forEach(b=>b.addEventListener("click",()=>{studentStatusFilter=b.dataset.studentStatus;rerenderKeepScroll();}));
  const sortBtn=byId("studentSortToggle");
  if(sortBtn)sortBtn.addEventListener("click",()=>{studentSortDir=studentSortDir==="desc"?"asc":"desc";refreshStudentList();sortBtn.textContent="年龄 "+(studentSortDir==="desc"?"大 → 小 ↓":"小 → 大 ↑");});
  // ＋ 关联课程 / 移除关联（v20260611f）
  const linkToggle=document.querySelector("[data-link-course-toggle]");
  if(linkToggle)linkToggle.addEventListener("click",()=>{studentLinkPickerOpen=!studentLinkPickerOpen;render();});
  document.querySelectorAll("[data-link-course]").forEach(b=>b.addEventListener("click",()=>{
    if(adminViewEmail){showToast("正在查看他人数据，只能浏览不能修改");return;}
    const c=scheduleData.find(x=>x.id===b.dataset.linkCourse);
    if(!c||!editingStudentName)return;
    if((c.students||[]).some(s=>(s.name||"").trim()===editingStudentName)){showToast("TA 已经在这门课里了");return;}
    c.students=[...(c.students||[]),{id:uid("student"),name:editingStudentName,note:"",joinedAt:dateKey(new Date())}];
    saveSchedule();
    studentLinkPickerOpen=false;
    showToast("已把 "+editingStudentName+" 加进「"+c.className+"」");
    render();
  }));
  document.querySelectorAll("[data-unlink-course]").forEach(b=>b.addEventListener("click",e=>{
    e.stopPropagation();
    if(adminViewEmail){showToast("正在查看他人数据，只能浏览不能修改");return;}
    const c=scheduleData.find(x=>x.id===b.dataset.unlinkCourse);
    if(!c||!editingStudentName)return;
    askConfirm("把 "+editingStudentName+" 从「"+c.className+"」的学生栏移除？\n已有的点名、作业记录不会被删。",()=>{
      c.students=(c.students||[]).filter(s=>(s.name||"").trim()!==editingStudentName);
      saveSchedule();
      showToast("已移除关联");
      render();
    },{okText:"移除"});
  }));
  const editBtn=document.querySelector("[data-edit-student]");
  if(editBtn)editBtn.addEventListener("click",()=>{studentDetailEditing=true;render();});
  const cancelBtn=document.querySelector("[data-cancel-student-edit]");
  if(cancelBtn)cancelBtn.addEventListener("click",()=>{studentDetailEditing=false;render();});
  const save=document.querySelector("[data-save-student]");
  if(save)save.addEventListener("click",()=>{
    if(adminViewEmail){showToast("正在查看他人数据，只能浏览不能修改");return;}
    const name=byId("stuName").value.trim();
    if(!name){showToast("姓名不能为空");return;}
    const id=save.dataset.saveStudent;
    const old=id?studentsData.find(x=>x.id===id):null;
    const profile=normalizeStudentProfile({
      id:old?old.id:undefined,
      createdAt:old?old.createdAt:undefined,
      name:name,
      gender:byId("stuGender").value,
      birthday:byId("stuBirthday").value,
      grade:byId("stuGrade").value.trim(),
      school:byId("stuSchool").value.trim(),
      city:byId("stuCity").value.trim(),
      parentName:byId("stuParent").value.trim(),
      parentContact:byId("stuContact").value.trim(),
      enrollDate:byId("stuEnroll").value,
      status:byId("stuStatus").value,
      note:byId("stuNote").value.trim()
    });
    profile.updatedAt=new Date().toISOString();
    if(old){
      const i=studentsData.findIndex(x=>x.id===old.id);
      studentsData[i]=profile;
    }else{
      if(studentsData.some(x=>x.name===name)){showToast("已有同名档案，请在名册里点开 TA 编辑");return;}
      studentsData.push(profile);
    }
    saveStudents();
    editingStudentName=profile.name;
    studentDetailEditing=false;
    showToast("已保存 "+profile.name+" 的档案");
    render();
  });
  const del=document.querySelector("[data-delete-student]");
  if(del)del.addEventListener("click",()=>{
    if(adminViewEmail){showToast("正在查看他人数据，只能浏览不能修改");return;}
    const p=studentsData.find(x=>x.id===del.dataset.deleteStudent);
    if(!p)return;
    askConfirm("确认删除 "+p.name+" 的档案？只删档案，课程里的名字不受影响。",()=>{
      studentsData=studentsData.filter(x=>x.id!==p.id);
      saveStudents();
      showToast("已删除档案");
      render();
    },{okText:"删除档案"});
  });
}

/* 搜索框：只刷新左侧列表不整页重渲染，保持输入焦点（capture 抢在其他处理器之前） */
document.addEventListener("input",function(e){
  if(e.target&&e.target.id==="studentSearch"){
    e.stopImmediatePropagation();
    studentSearch=e.target.value;
    refreshStudentList();
  }
},true);

/* 课程详情弹窗里点学生名 → 关弹窗、跳到学生页并打开 TA 的档案 */
document.addEventListener("click",function(e){
  const link=e.target.closest&&e.target.closest("[data-student-name]");
  if(!link)return;
  e.stopPropagation();
  closeStickerDetail();
  view="students";
  studentSearch="";
  studentStatusFilter="all";
  editingStudentName=link.dataset.studentName||null;
  studentDetailEditing=false;
  stuTimelineCourse="all";stuTimelineKind="all";studentLinkPickerOpen=false;
  render();
},true);

/* ===== 学生管理 二期（v20260611c）：课堂点名 =====
   出勤+表现存在课程 classRecords 里（按日期），随 saveSchedule 同步云端：
   classRecords[i].attendance = { 学生名: {status:"到/缺席", tag:"迟到/请假", remark:"表现一句话"} }
   统计口径（Shirley 拍板）：只有 到/缺席 计入出勤统计；
   迟到/请假是额外备注标记，单独一组按钮，永远可见，不参与统计。 */
const ATTENDANCE_MAIN=["到","缺席"];
const ATTENDANCE_EXTRA=["迟到","请假"];

function attendanceStatusClass(st){return st==="到"?"att-ok":st==="迟到"?"att-late":st==="缺席"?"att-absent":"att-leave";}

/* 兼容 v20260611b 的旧数据：当时 迟到/请假 存在 status 里。
   口径（Shirley 2026-06-11 定）：迟到 = 到 + 迟到标记；请假 = 缺席 + 请假标记
   （人没来就是缺席，请假只是缺席的原因，所以请假计入缺席统计）。 */
function normalizeAttendanceEntry(a){
  a=a||{};
  let status=a.status||"",tag=a.tag||"";
  if(status==="迟到"){status="到";tag=tag||"迟到";}
  if(status==="请假"){status="缺席";tag=tag||"请假";}
  return {status,tag,remark:(a.remark||"").trim()};
}

function classAttendance(item,date){
  const records=Array.isArray(item.classRecords)?item.classRecords:[];
  const rec=records.find(r=>r.date===date);
  return (rec&&rec.attendance)||{};
}

/* ===== 四期 ★0：粘贴 AI 课堂观察 → 自动分配（v20260613f）=====
   Shirley 用外部 AI 生成一整段"学生课堂观察记录"（一行名字 + 下面一段，多个学生连排）。
   这里纯本地解析：按"名字标题行"切块，匹配到本班学生（支持"高翌容（易蓉）"这种别名），
   把每段填进对应学生当天的"表现"栏。完全不连付费 AI、不花钱。 */
function parseObservations(text,names){
  const norm=s=>String(s||"").replace(/\s/g,"").replace(/（/g,"(").replace(/）/g,")");
  const variants=h=>{const n=norm(h);const out=[n];const m=n.match(/^(.+?)\((.+?)\)$/);if(m){out.push(m[1]);out.push(m[2]);}return out.filter(Boolean);};
  // 一行是不是某学生的"标题"：短、不带句末标点、和某学生名互相包含（或别名匹配）
  const matchName=line=>{
    const L=norm(line);
    if(!L||L.length>16)return null;
    if(/[。！？!?，,、：:；;.]$/.test(line.trim()))return null;
    const vs=variants(line);
    for(const nm of names){
      const N=norm(nm);
      if(vs.some(v=>v===N||v.includes(N)||N.includes(v)))return nm;
    }
    return null;
  };
  const lines=String(text||"").replace(/\r/g,"").split("\n");
  const blocks=[];let cur=null;
  for(const raw of lines){
    const line=raw.trim();
    if(!line)continue;
    if(/^(学生)?课堂观察(记录)?$/.test(line))continue; // 跳过"学生课堂观察记录"这种总标题
    const hit=matchName(line);
    if(hit){cur={name:hit,lines:[]};blocks.push(cur);continue;}
    if(cur)cur.lines.push(line);
  }
  const matched=[],seen=new Set();
  blocks.forEach(b=>{const t=b.lines.join("").trim();if(t&&!seen.has(b.name)){matched.push({name:b.name,text:t});seen.add(b.name);}});
  const missing=names.filter(n=>!seen.has(n));
  return {matched,missing};
}

function attendanceSectionHtml(item,date){
  const students=item.students||[];
  if(!students.length)return "";
  const att=classAttendance(item,date);
  const marked=students.filter(s=>normalizeAttendanceEntry(att[s.name]).status).length;
  return `<div class="attendance-section">
    <div class="att-head">
      <h4>📋 ${formatDateShort(date)} 点名</h4>
      <i class="att-count" id="attCount">${marked}/${students.length}</i>
      <button class="obs-paste-btn" data-paste-obs type="button" title="把 AI 生成的课堂观察整段贴进来，自动分到每个学生">📋 粘贴课堂观察</button>
      <button class="sec-collapse" data-sec-collapse type="button" title="折叠/展开这一栏">收起 ▾</button>
    </div>
    <div class="obs-paste" id="obsPaste" hidden>
      <textarea class="obs-paste-area" id="obsPasteText" placeholder="把 AI 生成的整段课堂观察贴这里：每个学生「名字单独一行 + 下面一段观察」，多个学生连着贴都行。点下面按钮自动分到每个学生的表现栏。"></textarea>
      <div class="obs-paste-actions">
        <button class="btn primary" id="obsPasteApply" type="button">自动分配到学生</button>
        <span class="obs-paste-result" id="obsPasteResult"></span>
      </div>
    </div>
    <div class="att-rows">${students.map(s=>{
      const a=normalizeAttendanceEntry(att[s.name]);
      return `<div class="att-row att-row-2line" data-att-name="${safeAttr(s.name)}">
        <div class="att-row-top">
          <b class="att-name">${esc(s.name)}</b>
          <span class="att-btns">${ATTENDANCE_MAIN.map(st=>`<button class="att-btn ${attendanceStatusClass(st)} ${a.status===st?'on':''}" data-att-status="${safeAttr(st)}" type="button">${st}</button>`).join("")}</span>
          <span class="att-btns att-extra">${ATTENDANCE_EXTRA.map(t=>`<button class="att-btn att-tag ${attendanceStatusClass(t)} ${a.tag===t?'on':''}" data-att-tag="${safeAttr(t)}" type="button">${t}</button>`).join("")}</span>
        </div>
        <textarea class="att-remark att-remark-area" data-att-remark rows="1" placeholder="✎ 表现一句话（这一栏每节课填，会进 TA 的时间线）">${esc(a.remark)}</textarea>
      </div>`;
    }).join("")}</div>
    <p class="att-hint">出勤只统计 到 / 缺席。点"迟到"会自动算"到"、点"请假"会自动算"缺席"（标记只是补充原因）。点一下记上、再点取消，表现写完点别处自动保存。</p>
  </div>`;
}

function saveAttendanceEntry(item,date,name,patch){
  if(adminViewEmail){showToast("正在查看他人数据，只能浏览不能修改");return false;}
  const existing=scheduleData.find(x=>x.id===item.id);
  if(!existing){showToast("示例课程不能点名");return false;}
  const records=Array.isArray(existing.classRecords)?existing.classRecords.slice():[];
  let idx=records.findIndex(r=>r.date===date);
  if(idx<0){records.push({date});idx=records.length-1;}
  const rec={...records[idx]};
  const att={...(rec.attendance||{})};
  const cur={...normalizeAttendanceEntry(att[name]),...patch};
  if(!cur.status&&!cur.tag&&!(cur.remark||"").trim())delete att[name];else att[name]=cur;
  rec.attendance=att;
  rec.updatedAt=new Date().toISOString();
  records[idx]=rec;
  existing.classRecords=records;
  item.classRecords=records; // 弹窗里拿的可能是 occurrence 副本，保持同步
  saveSchedule();
  return true;
}

function bindAttendanceSection(item){
  const section=document.querySelector(".attendance-section");
  if(!section)return;
  const date=classRecordDate(item);
  const refreshCount=()=>{
    const total=section.querySelectorAll(".att-row").length;
    const marked=section.querySelectorAll(".att-row [data-att-status].on").length;
    const el=byId("attCount");
    if(el)el.textContent=marked+"/"+total;
  };
  section.querySelectorAll(".att-btn").forEach(btn=>btn.addEventListener("click",()=>{
    const row=btn.closest(".att-row");
    const wasOn=btn.classList.contains("on");
    const isTag=!!btn.dataset.attTag;
    const patch=isTag?{tag:wasOn?"":btn.dataset.attTag}:{status:wasOn?"":btn.dataset.attStatus};
    // 点标记自动带出勤：迟到默认算"到"，请假默认算"缺席"（已手动点过出勤则不动它）
    if(isTag&&!wasOn&&!row.querySelector("[data-att-status].on")){
      patch.status=btn.dataset.attTag==="请假"?"缺席":"到";
    }
    if(!saveAttendanceEntry(item,date,row.dataset.attName,patch))return;
    // 同组互斥：到/缺席 一组，迟到/请假 一组
    row.querySelectorAll(isTag?"[data-att-tag]":"[data-att-status]").forEach(b=>b.classList.remove("on"));
    if(!wasOn)btn.classList.add("on");
    if(isTag&&patch.status)row.querySelectorAll("[data-att-status]").forEach(b=>b.classList.toggle("on",b.dataset.attStatus===patch.status));
    refreshCount();
  }));
  section.querySelectorAll("[data-att-remark]").forEach(inp=>{
    autoGrowArea(inp);                                  // 进来先把已有内容撑开，长表现一眼看全
    inp.addEventListener("input",()=>autoGrowArea(inp)); // 边打边长高
    inp.addEventListener("change",()=>{
      const name=inp.closest(".att-row").dataset.attName;
      if(saveAttendanceEntry(item,date,name,{remark:inp.value.trim()}))showToast("已记下 "+name+" 的表现");
    });
  });
  // ★0 粘贴课堂观察 → 自动分配（v20260613f）
  const pasteBtn=section.querySelector("[data-paste-obs]");
  const panel=byId("obsPaste");
  if(pasteBtn&&panel)pasteBtn.addEventListener("click",()=>{
    panel.hidden=!panel.hidden;
    if(!panel.hidden){const t=byId("obsPasteText");if(t)t.focus();}
  });
  const applyBtn=byId("obsPasteApply");
  if(applyBtn)applyBtn.addEventListener("click",()=>{
    if(adminViewEmail){showToast("正在查看他人数据，只能浏览不能修改");return;}
    const text=(byId("obsPasteText")||{}).value||"";
    const names=(item.students||[]).map(s=>s.name);
    const {matched,missing}=parseObservations(text,names);
    const resEl=byId("obsPasteResult");
    if(!matched.length){if(resEl)resEl.textContent="没认出学生名——确认每个学生的名字单独占一行，且和本班学生名字一致。";return;}
    let n=0;
    const rows=[...section.querySelectorAll(".att-row")];
    matched.forEach(m=>{
      const row=rows.find(r=>r.dataset.attName===m.name);
      if(!row)return;
      const ta=row.querySelector("[data-att-remark]");
      if(ta){ta.value=m.text;autoGrowArea(ta);}
      saveAttendanceEntry(item,date,m.name,{remark:m.text});
      n++;
    });
    if(resEl)resEl.innerHTML=`✅ 已填入 <b>${n}</b> 人${missing.length?`　·　没粘到：${esc(missing.join("、"))}`:"　·　全班都配上了"}`;
    showToast("已自动分配 "+n+" 个学生的课堂观察");
  });
}

/* ===== 学生管理 三期（v20260611d）：作业跟踪 =====
   作业挂在每节课记录里：classRecords[i].homework =
   { content:"作业内容", entries:{ 学生名:{state:"未交/已交/已批改", score:"选填分数或评语"} } }
   口径：批改=点状态；分数评语选填（拍板#3）。布置了作业但没点状态 = 未交。 */
const HOMEWORK_STATES=["未交","已交","已批改"];

function hwStateClass(st){return st==="已批改"?"hw-done":st==="已交"?"hw-in":"hw-none";}

function classHomework(item,date){
  const records=Array.isArray(item.classRecords)?item.classRecords:[];
  const rec=records.find(r=>r.date===date);
  const hw=(rec&&rec.homework)||{};
  return {content:hw.content||"",entries:hw.entries||{}};
}

function homeworkAssigned(hw){
  return !!((hw.content||"").trim()||Object.keys(hw.entries||{}).length);
}

function homeworkSectionHtml(item,date){
  const students=item.students||[];
  if(!students.length)return "";
  const hw=classHomework(item,date);
  const done=students.filter(s=>{const st=(hw.entries[s.name]||{}).state;return st==="已交"||st==="已批改";}).length;
  return `<div class="attendance-section homework-section">
    <div class="att-head">
      <h4>📚 ${formatDateShort(date)} 作业</h4>
      <i class="att-count" id="hwCount">交 ${done}/${students.length}</i>
      <button class="sec-collapse" data-sec-collapse type="button" title="折叠/展开这一栏">收起 ▾</button>
    </div>
    <input class="hw-content" id="hwContent" placeholder="今天布置了什么作业？写一句（不布置可留空）" value="${safeAttr(hw.content)}">
    <div class="att-rows">${students.map(s=>{
      const e=hw.entries[s.name]||{};
      const st=HOMEWORK_STATES.includes(e.state)?e.state:"未交";
      return `<div class="att-row" data-hw-name="${safeAttr(s.name)}">
        <b class="att-name">${esc(s.name)}</b>
        <span class="att-btns">${HOMEWORK_STATES.map(x=>`<button class="att-btn hw-btn ${hwStateClass(x)} ${st===x?'on':''}" data-hw-state="${safeAttr(x)}" type="button">${x}</button>`).join("")}</span>
        <span></span>
        <input class="att-remark" data-hw-score placeholder="分数/评语，可不填" value="${safeAttr(e.score||"")}">
      </div>`;
    }).join("")}</div>
    <p class="att-hint">未交 → 已交 → 已批改，点哪个就是哪个；分数评语选填，填了就显示在学生时间线里。</p>
  </div>`;
}

function saveHomework(item,date,apply){
  if(adminViewEmail){showToast("正在查看他人数据，只能浏览不能修改");return false;}
  const existing=scheduleData.find(x=>x.id===item.id);
  if(!existing){showToast("示例课程不能记作业");return false;}
  const records=Array.isArray(existing.classRecords)?existing.classRecords.slice():[];
  let idx=records.findIndex(r=>r.date===date);
  if(idx<0){records.push({date});idx=records.length-1;}
  const rec={...records[idx]};
  const old=rec.homework||{};
  const hw={content:old.content||"",entries:{...(old.entries||{})}};
  apply(hw);
  // 清掉空条目：未交且没分数的不用存
  Object.keys(hw.entries).forEach(n=>{
    const e=hw.entries[n];
    if((!e.state||e.state==="未交")&&!(e.score||"").trim())delete hw.entries[n];
  });
  if(homeworkAssigned(hw))rec.homework=hw;else delete rec.homework;
  rec.updatedAt=new Date().toISOString();
  records[idx]=rec;
  existing.classRecords=records;
  item.classRecords=records;
  saveSchedule();
  return true;
}

function bindHomeworkSection(item){
  const section=document.querySelector(".homework-section");
  if(!section)return;
  const date=classRecordDate(item);
  const refreshCount=()=>{
    const total=section.querySelectorAll(".att-row").length;
    const done=[...section.querySelectorAll(".att-row")].filter(r=>{
      const on=r.querySelector("[data-hw-state].on");
      return on&&on.dataset.hwState!=="未交";
    }).length;
    const el=byId("hwCount");
    if(el)el.textContent="交 "+done+"/"+total;
  };
  const content=byId("hwContent");
  if(content)content.addEventListener("change",()=>{
    if(saveHomework(item,date,hw=>{hw.content=content.value.trim();}))showToast("已记下作业内容");
  });
  section.querySelectorAll(".hw-btn").forEach(btn=>btn.addEventListener("click",()=>{
    const row=btn.closest(".att-row");
    const name=row.dataset.hwName;
    const st=btn.dataset.hwState;
    if(!saveHomework(item,date,hw=>{
      const e={...(hw.entries[name]||{})};
      e.state=st;
      hw.entries[name]=e;
    }))return;
    row.querySelectorAll(".hw-btn").forEach(b=>b.classList.toggle("on",b===btn));
    refreshCount();
  }));
  section.querySelectorAll("[data-hw-score]").forEach(inp=>inp.addEventListener("change",()=>{
    const name=inp.closest(".att-row").dataset.hwName;
    if(saveHomework(item,date,hw=>{
      const e={...(hw.entries[name]||{})};
      e.score=inp.value.trim();
      hw.entries[name]=e;
    }))showToast("已记下 "+name+" 的分数/评语");
  }));
}

/* ===== 课程主页（Shirley 点名要的"专属课程页"）=====
   从课程详情弹窗点"课程主页"进入：课程信息 + 出勤率/作业率统计 +
   每个学生的小结 + 全部课堂记录时间线（点名、作业、笔记都在）。 */
let courseHomeId=null;
let courseHomeBack="students";
let courseRecOpenDates=new Set(); // 课堂记录里当前展开的日期（默认全折叠，点日期才展开）

function openCourseHome(id){
  courseHomeBack=(view==="courseHome")?courseHomeBack:view;
  if(courseHomeId!==id){courseHomeFrom="";courseHomeTo="";courseRecOpenDates=new Set();courseLinkPickerOpen=false;courseLinkSearch="";} // 换班时重置日期范围+折叠状态+关联学生选择器
  courseHomeId=id;
  view="courseHome";
  render();
}

function courseStats(c,since,until){
  const records=(Array.isArray(c.classRecords)?c.classRecords:[]).filter(r=>{
    const d=String(r.date||"");
    return (!since||d>=since)&&(!until||d<=until);
  });
  const s={att:0,abs:0,late:0,leave:0,hwAssigned:0,hwIn:0,hwGraded:0,lessons:0};
  records.forEach(rec=>{
    let counted=false;
    Object.keys(rec.attendance||{}).forEach(n=>{
      const a=normalizeAttendanceEntry(rec.attendance[n]);
      if(a.status==="到")s.att++;
      if(a.status==="缺席")s.abs++;
      if(a.tag==="迟到")s.late++;
      if(a.tag==="请假")s.leave++;
      if(a.status||a.tag||a.remark)counted=true;
    });
    const hw=rec.homework||{};
    if(homeworkAssigned(hw)){
      counted=true;
      // Shirley 拍板的口径：应交 = 当天出席（到）的人。缺席的不算应交；
      // 没点名的那天没法判断，就全员算应交。缺席但补交的照样算进已交（可能超 100%）。
      const rollTaken=Object.keys(rec.attendance||{}).some(n=>normalizeAttendanceEntry(rec.attendance[n]).status);
      (c.students||[]).forEach(st=>{
        const a=normalizeAttendanceEntry((rec.attendance||{})[st.name]);
        if(!rollTaken||a.status==="到")s.hwAssigned++;
        const e=(hw.entries||{})[st.name]||{};
        if(e.state==="已交"||e.state==="已批改")s.hwIn++;
        if(e.state==="已批改")s.hwGraded++;
      });
    }
    if(counted||rec.notes||rec.materials)s.lessons++;
  });
  s.attRate=(s.att+s.abs)?Math.round(s.att/(s.att+s.abs)*100):null;
  s.hwRate=s.hwAssigned?Math.round(s.hwIn/s.hwAssigned*100):null;
  s.gradeRate=s.hwIn?Math.round(s.hwGraded/s.hwIn*100):null;
  return s;
}

/* 加入本班的日期（v20260613a，Shirley：入学时间≠加入某班时间，一个孩子可能在好几个班）
   先看课程学生栏里手填的 joinedAt；没有就从"最早一条含 TA 的课堂记录"自动推断，
   两者都没有就返回空（不瞎猜）。 */
function courseJoinDate(c,name){
  const key=String(name||"").trim();
  const st=(c.students||[]).find(s=>(s.name||"").trim()===key);
  if(st&&st.joinedAt)return st.joinedAt;
  const dates=(Array.isArray(c.classRecords)?c.classRecords:[])
    .filter(r=>r.date&&(((r.attendance||{})[key])||(((r.homework&&r.homework.entries)||{})[key])))
    .map(r=>String(r.date)).sort();
  return dates[0]||"";
}
function courseJoinText(c,name){
  const d=courseJoinDate(c,name);
  const dd=parseLocalDate(d);
  if(!dd)return "";
  const days=Math.floor((new Date().setHours(0,0,0,0)-dd.getTime())/86400000);
  let span;
  if(days<=0)span="今天";
  else if(days<30)span=`${days} 天`;
  else if(days<365)span=`约 ${Math.floor(days/30)} 个月`;
  else span=`约 ${Math.floor(days/365)} 年`;
  return `${formatDateShort(d)} 加入本班 · ${span}`;
}

/* 课程学生按年龄从大到小排（没生日的排最后）（v20260613a，Shirley：从大到小、左到右） */
function sortStudentsByAge(students){
  return (students||[]).slice().sort((a,b)=>{
    const aa=studentAgeNum(studentsData.find(x=>(x.name||"").trim()===(a.name||"").trim()));
    const bb=studentAgeNum(studentsData.find(x=>(x.name||"").trim()===(b.name||"").trim()));
    if(aa===null&&bb===null)return 0;
    if(aa===null)return 1;
    if(bb===null)return -1;
    return bb-aa;
  });
}

/* 课程主页一个学生 = 一格纯文字资料（v20260613a，Shirley：用文字显示孩子资料，
   要年龄/年级/学校/城市/加入本班日期；出勤作业用轻彩色文字不套框）。
   外层按年龄从大到小排（见 renderCourseHome）。 */
function courseStudentLineHtml(c,name,since,until){
  const records=(Array.isArray(c.classRecords)?c.classRecords:[]).filter(r=>{
    const d=String(r.date||"");
    return (!since||d>=since)&&(!until||d<=until);
  });
  let att=0,abs=0,late=0,leave=0,hwAssigned=0,hwIn=0;
  records.forEach(rec=>{
    const raw=(rec.attendance||{})[name];
    if(raw){
      const a=normalizeAttendanceEntry(raw);
      if(a.status==="到")att++;
      if(a.status==="缺席")abs++;
      if(a.tag==="迟到")late++;
      if(a.tag==="请假")leave++;
    }
    const hw=rec.homework||{};
    if(homeworkAssigned(hw)){
      // 应交只算出席（到）的那天；没点名就照算
      const rollTaken=Object.keys(rec.attendance||{}).some(n=>normalizeAttendanceEntry(rec.attendance[n]).status);
      const a=normalizeAttendanceEntry(raw);
      if(!rollTaken||a.status==="到")hwAssigned++;
      const e=(hw.entries||{})[name]||{};
      if(e.state==="已交"||e.state==="已批改")hwIn++;
    }
  });
  // 档案资料按名字关联，纯文字显示
  const p=studentsData.find(x=>(x.name||"").trim()===String(name).trim());
  const age=studentAgeNum(p);
  const meta=[p&&p.grade,p&&p.school,p&&p.city].filter(Boolean).join(" · ");
  const joinText=courseJoinText(c,name);
  // 出勤/作业：轻彩色文字，不套框
  const roll=[];
  if(att)roll.push(`<i class="cs-n cs-ok">到 ${att}</i>`);
  if(abs)roll.push(`<i class="cs-n cs-abs">缺 ${abs}</i>`);
  if(late)roll.push(`<i class="cs-n cs-late">迟 ${late}</i>`);
  if(leave)roll.push(`<i class="cs-n cs-leave">假 ${leave}</i>`);
  const hwText=hwAssigned?`<i class="cs-n cs-hw">作业 ${hwIn}/${hwAssigned}</i>`:`<i class="cs-n cs-muted">暂无作业</i>`;
  return `<div class="cs-cell">
    <div class="cs-top"><button class="student-link cs-name" data-student-name="${safeAttr(name)}" type="button">${esc(name)}</button>${age!==null?`<span class="cs-age">${age}岁</span>`:""}</div>
    <div class="cs-meta${meta?"":" cs-meta-none"}">${meta?esc(meta):"未建档 · 点名字补资料"}</div>
    ${joinText?`<div class="cs-join">${esc(joinText)}</div>`:""}
    <div class="cs-roll">${roll.join("")||'<i class="cs-n cs-muted">还没点名</i>'}${hwText}</div>
  </div>`;
}

/* 课堂记录 v3（v20260612b，Shirley："很乱"）：
   每个学生一行（出勤+作业合在一起），长表现折叠两行点开看；
   日期是按钮，点了回到那一天的编辑弹窗直接改点名/作业/笔记。 */
function courseRecordEntryHtml(c,rec){
  const names=(c.students||[]).map(s=>s.name);
  const hw=rec.homework||{};
  const hwAss=homeworkAssigned(hw);
  const stuRows=names.map(n=>{
    const a=normalizeAttendanceEntry((rec.attendance||{})[n]);
    const e=hwAss?((hw.entries||{})[n]||{}):null;
    const st=e?(HOMEWORK_STATES.includes(e.state)?e.state:"未交"):"";
    if(!a.status&&!a.tag&&!a.remark&&!st)return "";
    const long=(a.remark||"").length>64;
    // 网格两列：姓名定宽对齐 | 出勤+作业彩签对齐，评语在第二列下方对齐缩进（Shirley 强迫症：所有东西要对齐）
    return `<div class="rec-stu-row">
      <span class="rec-stu-name">${esc(n)}</span>
      <div class="rec-stu-chips">
        ${a.status?`<i class="att-chip ${attendanceStatusClass(a.status)}">${esc(a.status)}</i>`:""}
        ${a.tag?`<i class="att-chip att-tag-chip ${attendanceStatusClass(a.tag)}">${esc(a.tag)}</i>`:""}
        ${st?`<i class="att-chip hw-chip ${hwStateClass(st)}">📚${st}${e.score?" "+esc(e.score):""}</i>`:""}
      </div>
      ${a.remark?`<div class="rec-stu-remark stu-tl-remark-wrap${long?' clampable':''}"><div class="stu-tl-remark2${long?' clamped':''}">${esc(a.remark)}</div>${long?'<span class="tl-expand-hint">▾ 点开看全部</span>':""}</div>`:""}
    </div>`;
  }).filter(Boolean).join("");
  const note=rec.notes||rec.materials||"";
  if(!stuRows&&!hwAss&&!note)return "";
  // 当天汇总（v20260612d）：日期下面利用左侧空间显示 到X 缺X · 交X 没交X
  let dAtt=0,dAbs=0,dLate=0,dLeave=0,dHwIn=0,dHwTotal=0;
  const rollTaken=names.some(n=>normalizeAttendanceEntry((rec.attendance||{})[n]).status);
  names.forEach(n=>{
    const a=normalizeAttendanceEntry((rec.attendance||{})[n]);
    if(a.status==="到")dAtt++;
    if(a.status==="缺席")dAbs++;
    if(a.tag==="迟到")dLate++;
    if(a.tag==="请假")dLeave++;
    if(hwAss&&(!rollTaken||a.status==="到")){
      dHwTotal++;
      const e=(hw.entries||{})[n]||{};
      if(e.state==="已交"||e.state==="已批改")dHwIn++;
    }
  });
  // 汇总用纯彩色文字（不套框），放在折叠头里，折着也能一眼看当天概况
  const sumText=[];
  if(dAtt)sumText.push(`<i class="cs-n cs-ok">到 ${dAtt}</i>`);
  if(dAbs)sumText.push(`<i class="cs-n cs-abs">缺 ${dAbs}</i>`);
  if(dLate)sumText.push(`<i class="cs-n cs-late">迟 ${dLate}</i>`);
  if(dLeave)sumText.push(`<i class="cs-n cs-leave">假 ${dLeave}</i>`);
  if(dHwTotal)sumText.push(`<i class="cs-n cs-hw">作业 ${dHwIn}/${dHwTotal}</i>`);
  const open=courseRecOpenDates.has(String(rec.date));
  // 折叠卡（v20260613b，Shirley：点开当天日期才看孩子详情，头部一键全展/全折）
  return `<div class="course-rec-entry${open?"":" collapsed"}" data-rec-date="${safeAttr(rec.date)}">
    <div class="course-rec-head">
      <button class="rec-toggle-zone" data-rec-toggle="${safeAttr(rec.date)}" type="button">
        <span class="rec-chevron">▸</span>
        <span class="rec-head-date">${esc(formatDateShort(rec.date))}</span>
        <span class="rec-head-sum">${sumText.join("")||'<i class="cs-n cs-muted">未记录</i>'}</span>
      </button>
      <button class="rec-edit-icon" data-edit-record-date="${safeAttr(rec.date)}" type="button" title="回到这天，直接改点名、作业、笔记">✎ 改这天</button>
    </div>
    <div class="course-rec-body">
      ${hw.content?`<div class="rec-hw-row"><span class="rec-hw-tag">📚 作业</span><span class="rec-hw-text">${esc(hw.content)}</span></div>`:""}
      ${stuRows}
      ${note?`<div class="rec-note-row"><span class="rec-note-tag">📝 笔记</span><span class="rec-note-text">${esc(note)}</span></div>`:""}
    </div>
  </div>`;
}

let courseHomeFrom=""; // 单班页日期范围（日历自选）
let courseHomeTo="";
let courseLinkPickerOpen=false; // 课程主页"＋ 关联学生"列表是否展开（v20260614a，镜像学生页"＋ 关联课程"）
let courseLinkSearch="";        // 关联学生选择器的搜索词

/* 课程主页"＋ 关联学生"：列出还没在这门课的学生，点一下就把名字写进课程学生栏。
   带搜索框（名字/学校/城市/家长），镜像学生页那套"＋ 关联课程"。（v20260614a） */
function courseLinkOptionsHtml(c){
  const existing=new Set((c.students||[]).map(s=>(s.name||"").trim()));
  const kw=courseLinkSearch.trim().toLowerCase();
  const filtered=studentRoster().filter(r=>!existing.has(r.name)).filter(r=>{
    if(!kw)return true;
    const p=r.profile;
    const hay=(r.name+" "+(p?[p.school,p.city,p.grade,p.parentName].join(" "):"")).toLowerCase();
    return hay.includes(kw);
  });
  if(!filtered.length)return `<p class="empty">${kw?"没找到匹配的学生（换个词试试）。":"所有学生都已经在这门课里了。"}</p>`;
  return filtered.map(r=>{
    const p=r.profile;const age=studentAgeNum(p);
    const meta=[age!==null?age+"岁":"",p&&p.grade,p&&p.school].filter(Boolean).join(" · ");
    return `<button class="link-course-option" data-link-student="${safeAttr(r.name)}" type="button"><b>${esc(r.name)}</b><small>${meta?esc(meta):"未建档"} · 已在 ${r.classes.length} 门课</small></button>`;
  }).join("");
}

function courseStudentLinkPickerHtml(c){
  return `<div class="link-course-picker">
    <p class="link-picker-hint">点一个学生，就把 TA 写进「${esc(c.className)}」的学生栏（和课程编辑页填名字是同一回事）：</p>
    <input class="search-input link-student-search" id="courseLinkSearch" value="${safeAttr(courseLinkSearch)}" placeholder="搜名字、学校、城市、家长…" autocomplete="off">
    <div class="link-course-list">${courseLinkOptionsHtml(c)}</div>
  </div>`;
}

/* 把某学生写进这门课（点选择器里的学生时调用） */
function bindCourseLinkOptions(c){
  document.querySelectorAll("[data-link-student]").forEach(b=>b.addEventListener("click",()=>{
    if(adminViewEmail){showToast("正在查看他人数据，只能浏览不能修改");return;}
    const name=b.dataset.linkStudent;
    if(!name)return;
    if((c.students||[]).some(s=>(s.name||"").trim()===name)){showToast("TA 已经在这门课里了");return;}
    c.students=[...(c.students||[]),{id:uid("student"),name:name,note:"",joinedAt:dateKey(new Date())}];
    saveSchedule();
    courseLinkPickerOpen=false;courseLinkSearch="";
    showToast("已把 "+name+" 加进「"+c.className+"」");
    render();
  }));
}

/* 只刷新选择器列表（搜索时用，不整页重渲染，保持输入框焦点） */
function refreshCourseLinkList(c){
  const listEl=document.querySelector(".course-home .link-course-list");
  if(!listEl)return;
  listEl.innerHTML=courseLinkOptionsHtml(c);
  bindCourseLinkOptions(c);
}

function renderCourseHome(){
  const c=scheduleData.find(x=>x.id===courseHomeId);
  if(!c){view=courseHomeBack||"students";render();return;}
  const since=courseHomeFrom,until=courseHomeTo;
  const rt=rangeText(since,until);
  const done=isClassDone(c);
  const s=courseStats(c,since,until);
  const records=(Array.isArray(c.classRecords)?c.classRecords:[])
    .filter(r=>{const d=String(r.date||"");return (!since||d>=since)&&(!until||d<=until);})
    .slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const recHtml=records.map(r=>courseRecordEntryHtml(c,r)).filter(Boolean).join("");
  // 排期瓦片：开课→结课 + 已上到第几堂 + 休息日（v20260612c）
  const sched=courseScheduleInfo(c);
  const skipsAll=skippedDates(c).slice().sort();
  const skipNote=skipsAll.length?`休息 ${skipsAll.slice(0,4).map(formatDateShort).join("、")}${skipsAll.length>4?` 等 ${skipsAll.length} 天`:""}`:"";
  const schedSmall=sched?[courseProgressText(sched),skipNote].filter(Boolean).join(" · "):"在编辑页填开课日期或指定上课日期";
  setHead(c.className+(done?"（已结课）":""),"","共 "+(c.students||[]).length+" 名学生");
  byId("tabs").innerHTML=`<button class="btn" id="courseHomeBack" type="button">← 返回</button>
    <span class="course-home-range">${dateRangeCtlHtml("ch",since,until)}</span>
    <button class="btn ghost course-edit-btn" id="courseHomeEdit" type="button" title="改时间、学生、排期、停课日期都在编辑页">✎ 编辑资料</button>`;
  byId("content").innerHTML=`<div class="course-home">
    <div class="stu-info-grid course-home-info">
      <div class="stu-tile t-blue"><span>时间</span><b>${esc(c.weekday)} ${esc(formatTimeCN(c.time))}</b></div>
      <div class="stu-tile t-green"><span>老师 · 课程</span><b>${esc(c.teacher||"未填")} · ${esc(c.courseType||"未填")}</b></div>
      <div class="stu-tile t-yellow"><span>Zoom · 学期</span><b>${esc(zoomName(c)||"未填")} · ${esc(c.term||classTermLabel(c))}</b></div>
      <div class="stu-tile ${sched?'t-pink':'no-val'}"><span>开课 → 结课</span><b>${sched?`${esc(formatDateShort(sched.first))} → ${esc(formatDateShort(sched.last))}`:"未填排期"}</b><small class="ov-tile-detail">${esc(schedSmall)}</small></div>
    </div>
    <div class="stu-info-grid course-home-stats">
      <div class="stu-tile t-green"><span>已记录课次 · ${esc(rt)}</span><b>${s.lessons||0} 次</b><small class="ov-tile-detail">班里 ${(c.students||[]).length} 名学生</small></div>
      <div class="stu-tile ${s.attRate===null?'no-val':'t-blue'}"><span>出勤率 · ${esc(rt)}</span><b>${s.attRate===null?"还没点过名":s.attRate+"%"}</b>${s.attRate===null?"":`<small class="ov-tile-detail">到 ${s.att} 人次 / 缺席 ${s.abs} 人次</small>`}</div>
      <div class="stu-tile ${s.hwRate===null?'no-val':'t-yellow'}"><span>作业提交率 · ${esc(rt)}</span><b>${s.hwRate===null?"还没布置过":s.hwRate+"%"}</b>${s.hwRate===null?"":`<small class="ov-tile-detail">交 ${s.hwIn} / 应交 ${s.hwAssigned}（只算出席的）</small>`}</div>
      <div class="stu-tile ${s.gradeRate===null?'no-val':'t-green'}"><span>已交里批改率 · ${esc(rt)}</span><b>${s.gradeRate===null?"还没人交":s.gradeRate+"%"}</b>${s.gradeRate===null?"":`<small class="ov-tile-detail">已改 ${s.hwGraded} / 已交 ${s.hwIn}</small>`}</div>
    </div>
    <div class="student-detail-extra">
      <div class="rec-section-head"><h4>学生（点名字看档案 · 按年龄大→小排 · 数字按${esc(rt)}算）</h4><button class="btn ghost stu-link-toggle" id="courseLinkToggle" type="button">${courseLinkPickerOpen?"收起":"＋ 关联学生"}</button></div>
      ${courseLinkPickerOpen?courseStudentLinkPickerHtml(c):""}
      <div class="course-student-grid">${sortStudentsByAge(c.students||[]).map(st=>courseStudentLineHtml(c,st.name,since,until)).join("")||'<p class="empty">课程里还没填学生：点右上"＋ 关联学生"，或去编辑页"学生"栏填名字。</p>'}</div>
      <div class="rec-section-head"><h4>${esc(rt)}课堂记录（${records.length} 天）</h4>${records.length?`<button class="rec-foldall-btn" id="recFoldAll" type="button">${records.every(r=>courseRecOpenDates.has(String(r.date)))?"▾ 全部折叠":"▸ 全部展开"}</button>`:""}</div>
      ${recHtml||'<p class="empty">这段时间没有记录。上课时在课程详情弹窗里点名、记作业、写笔记，都会汇总到这里。</p>'}
    </div>
  </div>`;
  byId("courseHomeBack").addEventListener("click",()=>{view=courseHomeBack||"students";render();});
  bindDateRangeCtl("ch",(f,t)=>{courseHomeFrom=f;courseHomeTo=t;rerenderKeepScroll();});
  // 编辑课程资料 → 跳到管理页的课程编辑器（结课也在那边）
  byId("courseHomeEdit").addEventListener("click",()=>{
    view="manage";manageMode="classes";
    manageClassSearch="";manageClassType="all";
    editingClassId=c.id;manageClassRecordDate="";
    render();
  });
  // 点课堂记录的日期头 → 展开/收起当天详情（只改 DOM，不整页重渲染，保持滚动位置）
  document.querySelectorAll("[data-rec-toggle]").forEach(b=>b.addEventListener("click",()=>{
    const d=b.dataset.recToggle;
    const entry=b.closest(".course-rec-entry");
    if(!entry)return;
    if(courseRecOpenDates.has(d)){courseRecOpenDates.delete(d);entry.classList.add("collapsed");}
    else{courseRecOpenDates.add(d);entry.classList.remove("collapsed");}
    refreshRecFoldAllBtn(records);
  }));
  // 一键全部展开 / 全部折叠
  const foldAll=byId("recFoldAll");
  if(foldAll)foldAll.addEventListener("click",()=>{
    const allOpen=records.every(r=>courseRecOpenDates.has(String(r.date)));
    if(allOpen){courseRecOpenDates=new Set();}
    else{courseRecOpenDates=new Set(records.map(r=>String(r.date)));}
    document.querySelectorAll(".course-rec-entry").forEach(en=>{
      const d=en.dataset.recDate;
      en.classList.toggle("collapsed",!courseRecOpenDates.has(d));
    });
    refreshRecFoldAllBtn(records);
  });
  // 点记录的日期 → 回到那一天的编辑弹窗，直接改点名/作业/笔记
  document.querySelectorAll("[data-edit-record-date]").forEach(b=>b.addEventListener("click",e=>{
    e.stopPropagation();
    recordDateOverride=b.dataset.editRecordDate;
    openClassDetailModal(c);
  }));
  // "＋ 关联学生"：展开/收起选择器 + 搜索 + 点学生写进课程（v20260614a）
  const linkToggle=byId("courseLinkToggle");
  if(linkToggle)linkToggle.addEventListener("click",()=>{courseLinkPickerOpen=!courseLinkPickerOpen;if(!courseLinkPickerOpen)courseLinkSearch="";render();});
  const linkSearch=byId("courseLinkSearch");
  if(linkSearch)linkSearch.addEventListener("input",()=>{courseLinkSearch=linkSearch.value;refreshCourseLinkList(c);});
  bindCourseLinkOptions(c);
}

/* 刷新"全部展开/折叠"按钮文字（不整页重渲染） */
function refreshRecFoldAllBtn(records){
  const btn=byId("recFoldAll");
  if(!btn)return;
  const allOpen=records.length&&records.every(r=>courseRecOpenDates.has(String(r.date)));
  btn.textContent=allOpen?"▾ 全部折叠":"▸ 全部展开";
}

/* ===== 老师面板 + 作业欠交红黑榜（v20260614b）=====
   Shirley 的真实工作流：黑榜帮她看清"这周哪些孩子作业累积欠交、第几次、几号没交什么"，
   然后记录她的跟进动作（跟家长谈了没、家长怎么回、孩子后续状态、有没有效果），跨周累积。
   老师面板：上面所有老师横向对比表，点一个老师 → 下面展开 TA 的班 + 黑榜按这个老师的学生筛。
   跟进记录存在学生档案 followups 里（跟 students 列上云，不用改数据库）。 */
const FOLLOWUP_STATUS=["已联系家长 · 观察中","家长会配合督促","孩子已改善","已解决","沟通了暂无改善"];
let followupFormFor="";   // 当前展开"记录跟进"表单的学生名
// 老师页筛选（镜像课程总览）
let teacherType="all";    // all | LR | CW | CR | EW | MV | 其他
let teacherTerm="all";    // all | 上半年 | 下半年 | 假期营 | 1对1 | 结课
let teacherShowDone=false;
let teacherFrom="";
let teacherTo="";
let teacherPanelSel="";   // 点开看详情的老师

/* 把给定课程池按老师分组，算每个老师的汇总（班数/学生数去重/出勤·提交·批改率） */
function teacherSummary(pool,since,until){
  const map={};
  pool.forEach(c=>{
    const t=(c.teacher||"").trim()||"未填老师";
    if(!map[t])map[t]={teacher:t,courses:[],students:new Set()};
    map[t].courses.push(c);
    (c.students||[]).forEach(s=>{const n=(s.name||"").trim();if(n)map[t].students.add(n);});
  });
  return Object.values(map).map(m=>{
    let att=0,abs=0,hwAssigned=0,hwIn=0,hwGraded=0,lessons=0;
    m.courses.forEach(c=>{const s=courseStats(c,since,until);att+=s.att;abs+=s.abs;hwAssigned+=s.hwAssigned;hwIn+=s.hwIn;hwGraded+=s.hwGraded;lessons+=s.lessons;});
    return {teacher:m.teacher,courses:m.courses,courseCount:m.courses.length,studentCount:m.students.size,
      attRate:(att+abs)?Math.round(att/(att+abs)*100):null,
      hwRate:hwAssigned?Math.round(hwIn/hwAssigned*100):null,
      gradeRate:hwIn?Math.round(hwGraded/hwIn*100):null,
      att,abs,hwAssigned,hwIn,hwGraded,lessons};
  }).sort((a,b)=>{
    // 批改率是老师页的重点：批改率低的排前（提醒该批改了）；没数据的排后
    const ga=a.gradeRate,gb=b.gradeRate;
    if(ga===null&&gb===null)return b.courseCount-a.courseCount;
    if(ga===null)return 1;
    if(gb===null)return -1;
    return ga-gb||b.courseCount-a.courseCount;
  });
}

/* 这段时间内每个学生的"作业欠交"明细。teacher 非空时只看那个老师的班。
   口径和课程主页一致：当天布置了作业、且（点过名时）学生那天"到"，但状态不是已交/已批改 = 欠交一次。
   返回 {owed:{名:{name,occ:[{date,className,hw}]}}, sub:{名:{assigned,submitted}}} */
function homeworkOwedInRange(since,until,teacher){
  const owed={},sub={};
  overviewCourses().forEach(c=>{
    if(teacher&&((c.teacher||"").trim()||"未填老师")!==teacher)return;
    (Array.isArray(c.classRecords)?c.classRecords:[]).forEach(rec=>{
      const d=String(rec.date||"");
      if((since&&d<since)||(until&&d>until))return;
      const hw=rec.homework||{};
      if(!homeworkAssigned(hw))return;
      const rollTaken=Object.keys(rec.attendance||{}).some(n=>normalizeAttendanceEntry(rec.attendance[n]).status);
      (c.students||[]).forEach(st=>{
        const name=(st.name||"").trim();if(!name)return;
        const a=normalizeAttendanceEntry((rec.attendance||{})[name]);
        if(rollTaken&&a.status!=="到")return; // 缺席不算应交
        if(!sub[name])sub[name]={assigned:0,submitted:0};
        sub[name].assigned++;
        const e=(hw.entries||{})[name]||{};
        if(e.state==="已交"||e.state==="已批改"){sub[name].submitted++;return;}
        if(!owed[name])owed[name]={name,occ:[]};
        owed[name].occ.push({date:d,className:c.className,hw:(hw.content||"").trim()});
      });
    });
  });
  return {owed,sub};
}

/* 学生档案里的跟进记录（找不到档案返回空数组） */
function studentFollowups(name){
  const p=studentsData.find(x=>(x.name||"").trim()===String(name).trim());
  return (p&&Array.isArray(p.followups))?p.followups:[];
}
/* 找不到档案就建一个最小档案（和"保存一次即建档"一致），保证跟进记录有处可存 */
function ensureProfileFor(name){
  const key=String(name||"").trim();
  let p=studentsData.find(x=>(x.name||"").trim()===key);
  if(!p){p=normalizeStudentProfile({name:key});studentsData.push(p);}
  if(!Array.isArray(p.followups))p.followups=[];
  return p;
}
function addFollowup(name,entry){
  const p=ensureProfileFor(name);
  p.followups.push(entry);p.updatedAt=new Date().toISOString();
  saveStudents();
}
function deleteFollowup(name,id){
  const p=studentsData.find(x=>(x.name||"").trim()===String(name).trim());
  if(!p||!Array.isArray(p.followups))return;
  p.followups=p.followups.filter(f=>f.id!==id);p.updatedAt=new Date().toISOString();
  saveStudents();
}

function followupFormHtml(name){
  const today=dateKey(new Date());
  return `<div class="fu-form" data-bb-form="${safeAttr(name)}">
    <div class="fu-form-grid">
      <label class="fu-field"><span>跟进日期</span><input type="date" class="bb-f-date" value="${today}"></label>
      <label class="fu-field"><span>跟进后状态</span><select class="bb-f-status">${FOLLOWUP_STATUS.map(s=>`<option value="${safeAttr(s)}">${s}</option>`).join("")}</select></label>
    </div>
    <label class="fu-field"><span>我做了什么 / 用了什么话术</span><textarea class="bb-f-action" rows="2" placeholder="例：私信家长说明孩子连续两次没交，建议每天固定一个写作业时间…"></textarea></label>
    <label class="fu-field"><span>家长怎么回应</span><textarea class="bb-f-reply" rows="2" placeholder="例：家长说最近忙，会盯着孩子按时交"></textarea></label>
    <label class="fu-field"><span>孩子后续 / 有没有改善</span><input class="bb-f-result" placeholder="例：本周交了 2 次，继续观察"></label>
    <div class="fu-form-ops"><button class="btn primary bb-f-save" data-bb-save="${safeAttr(name)}" type="button">保存这次跟进</button><button class="btn ghost bb-f-cancel" type="button">取消</button></div>
  </div>`;
}
function followupItemHtml(name,f){
  return `<div class="fu-item">
    <div class="fu-item-head"><b class="fu-item-date">${esc(formatDateShort(f.date))}</b>${f.status?`<i class="fu-item-status">${esc(f.status)}</i>`:""}<button class="fu-item-del" data-bb-fu-del="${safeAttr(name)}|${safeAttr(f.id)}" type="button" title="删除这条跟进">✕</button></div>
    ${f.action?`<p class="fu-item-line"><span>我做了</span><em>${esc(f.action)}</em></p>`:""}
    ${f.parentReply?`<p class="fu-item-line"><span>家长回应</span><em>${esc(f.parentReply)}</em></p>`:""}
    ${f.result?`<p class="fu-item-line"><span>孩子后续</span><em>${esc(f.result)}</em></p>`:""}
  </div>`;
}

/* 跟进表单/历史的事件绑定（学生页用，可复用）。改完整页重渲染。 */
function bindFollowupControls(){
  document.querySelectorAll("[data-bb-log]").forEach(b=>b.addEventListener("click",()=>{
    const n=b.dataset.bbLog;followupFormFor=(followupFormFor===n)?"":n;render();
  }));
  document.querySelectorAll(".bb-f-cancel").forEach(b=>b.addEventListener("click",()=>{followupFormFor="";render();}));
  document.querySelectorAll("[data-bb-save]").forEach(b=>b.addEventListener("click",()=>{
    if(adminViewEmail){showToast("正在查看他人数据，只能浏览不能修改");return;}
    const name=b.dataset.bbSave;
    const form=b.closest(".fu-form");if(!form)return;
    const date=form.querySelector(".bb-f-date").value||dateKey(new Date());
    const action=form.querySelector(".bb-f-action").value.trim();
    const parentReply=form.querySelector(".bb-f-reply").value.trim();
    const result=form.querySelector(".bb-f-result").value.trim();
    const status=form.querySelector(".bb-f-status").value;
    if(!action&&!parentReply&&!result){showToast("至少写一句你做了什么");return;}
    addFollowup(name,{id:uid("fu"),date,action,parentReply,result,status,loggedAt:new Date().toISOString()});
    followupFormFor="";
    showToast("已记下对「"+name+"」的跟进");
    render();
  }));
  document.querySelectorAll("[data-bb-fu-del]").forEach(b=>b.addEventListener("click",()=>{
    if(adminViewEmail){showToast("正在查看他人数据，只能浏览不能修改");return;}
    const [name,id]=b.dataset.bbFuDel.split("|");
    askConfirm("删除这条跟进记录？",()=>{deleteFollowup(name,id);showToast("已删除");render();},{okText:"删除"});
  }));
}

/* 学生档案页里的"作业跟进"小节：本周欠交 + 累计欠交明细 + 记录跟进表单 + 跟进历史（v20260614c，黑榜归位到学生页） */
function studentFollowupSectionHtml(name){
  const def=quickRange("week");
  const owedWeek=(homeworkOwedInRange(def[0],def[1],"").owed[name]||{occ:[]}).occ;
  const owedAll=(homeworkOwedInRange("","","").owed[name]||{occ:[]}).occ;
  const fus=studentFollowups(name).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const formOpen=followupFormFor===name;
  const allDetail=owedAll.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)))
    .map(o=>`<span class="fu-miss"><b>${esc(formatDateShort(o.date))}</b> ${esc(o.className)}${o.hw?`《${esc(o.hw)}》`:""}</span>`).join("");
  return `<section class="fu-card">
    <div class="fu-card-head"><h4>📚 作业跟进</h4>${owedWeek.length?`<i class="fu-badge fu-badge-alert">本周欠交 ${owedWeek.length} 次</i>`:`<i class="fu-badge fu-badge-ok">本周交齐 👍</i>`}</div>
    ${owedAll.length?`<div class="fu-owed"><span class="fu-owed-cap">累计欠交 <b>${owedAll.length}</b> 次</span><div class="fu-miss-list">${allDetail}</div></div>`:'<p class="fu-empty">目前没有欠交记录，很棒 👍</p>'}
    <div class="fu-act-row"><button class="btn ${formOpen?'ghost':'primary'} fu-log-btn" data-bb-log="${safeAttr(name)}" type="button">${formOpen?"收起":"✎ 记录一次跟进"}</button></div>
    ${formOpen?followupFormHtml(name):""}
    ${fus.length?`<div class="fu-history"><h5 class="fu-history-cap">跟进记录 · ${fus.length} 条</h5>${fus.map(f=>followupItemHtml(name,f)).join("")}</div>`:(formOpen?"":'<p class="fu-empty">还没有跟进记录。孩子累积欠交时，点上面"记录一次跟进"，写下你做了什么、家长怎么回、孩子后续。</p>')}
  </section>`;
}

/* 学生页没选学生时的落地内容：作业欠交黑榜（跟着顶部 类别/学期/时间 筛选走，点名字进档案跟进） */
function studentBoardHtml(){
  const def=quickRange("week");
  const since=studentRange?studentRange.from:def[0];
  const until=studentRange?studentRange.to:def[1];
  const rt=rangeText(since,until);
  const names=new Set(filteredRoster().map(r=>r.name));
  const owed=homeworkOwedInRange(since,until,"").owed;
  const followedIn=n=>studentFollowups(n).some(f=>!since||String(f.date)>=since);
  const list=Object.values(owed).filter(b=>names.has(b.name)).sort((a,b)=>{
    const fa=followedIn(a.name),fb=followedIn(b.name);
    if(fa!==fb)return fa?1:-1;
    return b.occ.length-a.occ.length||a.name.localeCompare(b.name,"zh-Hans-CN");
  });
  const todoCount=list.filter(b=>!followedIn(b.name)).length;
  const rows=list.map(b=>{
    const followed=followedIn(b.name);
    return `<button class="bb-board-row${followed?"":" bb-row-alert"}" data-pick-student="${safeAttr(b.name)}" type="button">
      <span class="bb-name">${esc(b.name)}</span>
      <span class="bb-count">${esc(rt)}欠交 <b>${b.occ.length}</b> 次</span>
      <i class="bb-status ${followed?'bb-done':'bb-todo'}">${followed?'🟡 已跟进':'🔴 待跟进'}</i>
    </button>`;
  }).join("");
  return `<div class="stu-board">
    <div class="bb-section-head"><h3>📕 作业欠交黑榜 · ${esc(rt)}</h3><span class="bb-todo-badge ${todoCount?'on':''}">${todoCount?`🔴 ${todoCount} 人待跟进`:"✓ 都跟进过了"}</span></div>
    <p class="bb-hint">这段时间累积欠交作业的孩子（跟着上面的类别/学期/时间筛选）。🔴 = 还没记录跟进，需要你去找家长。点名字进 TA 的档案，在"作业跟进"里写下你做了什么、家长怎么回。</p>
    ${rows||'<p class="empty">这个筛选/时间范围内没有人欠交作业 👍。</p>'}
  </div>`;
}

/* ===== 老师面板（v20260614c，归位重构）：只放老师的事，镜像课程总览页 =====
   筛选（类别×学期×含已结课×时间）+ 汇总（老师数/班级数/出席/交作业/批改）+
   老师对比表（重点看批改率，低的排前）+ 点开看 TA 的班和学生。
   作业欠交黑榜已搬到学生页（学生的事归学生）。老师可编辑资料+沟通笔记待加 teachers 字段。 */
function renderTeachers(){
  const allPool=overviewCourses();
  const doneCount=allPool.filter(isClassDone).length;
  const termIsDone=teacherTerm==="结课";
  const all=termIsDone?allPool:(teacherShowDone?allPool:allPool.filter(c=>!isClassDone(c)));
  const codeOf=c=>courseCode(c)||"其他";
  const cats=["LR","CW","CR","EW","MV"];
  if(all.some(c=>codeOf(c)==="其他"))cats.push("其他");
  const pool=all.filter(c=>
    (teacherType==="all"||codeOf(c)===teacherType)&&
    (termIsDone?isClassDone(c):(teacherTerm==="all"||classTermLabel(c)===teacherTerm))
  );
  const since=teacherFrom,until=teacherTo;
  const rt=rangeText(since,until);
  const summary=teacherSummary(pool,since,until);
  if(teacherPanelSel&&!summary.some(t=>t.teacher===teacherPanelSel))teacherPanelSel="";
  const sel=teacherPanelSel?summary.find(t=>t.teacher===teacherPanelSel):null;
  // 汇总
  const agg={att:0,abs:0,hwAssigned:0,hwIn:0,hwGraded:0,lessons:0};
  summary.forEach(t=>{agg.att+=t.att;agg.abs+=t.abs;agg.hwAssigned+=t.hwAssigned;agg.hwIn+=t.hwIn;agg.hwGraded+=t.hwGraded;agg.lessons+=t.lessons;});
  const aggAtt=(agg.att+agg.abs)?Math.round(agg.att/(agg.att+agg.abs)*100):null;
  const aggHw=agg.hwAssigned?Math.round(agg.hwIn/agg.hwAssigned*100):null;
  const aggGrade=agg.hwIn?Math.round(agg.hwGraded/agg.hwIn*100):null;
  const allStudents=new Set();pool.forEach(c=>(c.students||[]).forEach(s=>{const n=(s.name||"").trim();if(n)allStudents.add(n);}));
  const chip=(cur,val,label,key)=>`<button class="tab ${cur===val?'active':''}" data-${key}="${safeAttr(val)}" type="button">${esc(label)}</button>`;

  // 选了老师 → 跳到独立的老师详情页（带返回），不在列表底部展开
  if(sel){renderTeacherDetail(sel,since,until,rt);return;}

  setHead("老师面板","","共 "+summary.length+" 位老师");
  byId("tabs").innerHTML="";

  const tableRows=summary.map(t=>`<button class="tt-row${t.gradeRate!==null&&t.gradeRate<60?' tt-grade-low':''}" data-teacher-pick="${safeAttr(t.teacher)}" type="button">
    <span class="tt-name"><b>${esc(t.teacher)}</b><small>${t.courseCount} 班 · ${t.studentCount} 名学生</small></span>
    ${rateChip("出席",t.attRate)}
    ${rateChip("交作业",t.hwRate)}
    ${rateChip("批改率",t.gradeRate,t.gradeRate===null?"":`已改 ${t.hwGraded}/${t.hwIn}`)}
    <span class="tt-go">查看 ›</span>
  </button>`).join("")||'<p class="empty">这个筛选下没有老师。换个类别/学期，或去"管理→管理课程"建课填老师。</p>';

  byId("content").innerHTML=`<div class="course-home course-overview teacher-panel">
    <div class="ov-toolbar">
      <span class="ov-group"><i>类别</i>${chip(teacherType,"all","全部","tt-type")}${cats.map(t=>chip(teacherType,t,catLabel(t),"tt-type")).join("")}</span>
      <span class="ov-group"><i>学期</i>${chip(teacherTerm,"all","全部","tt-term")}${TERM_OPTIONS.map(t=>chip(teacherTerm,t,t,"tt-term")).join("")}${chip(teacherTerm,"结课","结课"+(doneCount?" "+doneCount:""),"tt-term")}</span>
      <span class="ov-group"><button class="tab ov-done-toggle ${teacherShowDone?'active':''}" data-tt-done type="button">含已结课${doneCount?" "+doneCount:""}</button></span>
      <span class="ov-group ov-group-time"><i>时间</i>${dateRangeCtlHtml("tp",since,until)}</span>
    </div>
    <div class="stu-info-grid course-home-stats ov-stats">
      <div class="stu-tile t-blue"><span>老师数</span><b>${summary.length} 位</b><small class="ov-tile-detail">${pool.length} 个班 · 平均 ${summary.length?(pool.length/summary.length).toFixed(1):0} 班/人</small></div>
      <div class="stu-tile t-green"><span>学生数（去重）</span><b>${allStudents.size} 人</b><small class="ov-tile-detail">同名只算一次</small></div>
      ${rateTile("出席率 · "+rt,aggAtt,aggAtt===null?"":`到 ${agg.att} / 缺 ${agg.abs}`)}
      ${rateTile("交作业率 · "+rt,aggHw,aggHw===null?"这段时间没布置过":`交 ${agg.hwIn} / 应交 ${agg.hwAssigned}`)}
      ${rateTile("批改率 · "+rt,aggGrade,aggGrade===null?"还没人交":`已改 ${agg.hwGraded} / 已交 ${agg.hwIn}`)}
    </div>
    <div class="student-detail-extra">
      <h4>老师对比 · ${esc(rt)}（批改率低的排前面，提醒该批改了 · 点一位老师看详情）</h4>
      <div class="teacher-table">${tableRows}</div>
    </div>
    <p class="student-phase-hint">批改率 = 已批改 ÷ 已交，是老师该做的事，低于 60% 标红。作业欠交（学生的事）已挪到「学生」页。</p>
  </div>`;
  bindTeacherPanelEvents();
}

/* 老师详情页（独立一页，带返回 —— 镜像课程主页的进出方式） */
function renderTeacherDetail(sel,since,until,rt){
  const students=[...new Set(sel.courses.flatMap(c=>(c.students||[]).map(s=>(s.name||"").trim()).filter(Boolean)))].sort((a,b)=>a.localeCompare(b,"zh-Hans-CN"));
  setHead(sel.teacher,"",sel.courseCount+" 班 · "+sel.studentCount+" 名学生");
  byId("tabs").innerHTML=`<button class="btn" id="teacherBack" type="button">← 返回老师列表</button>`;
  byId("content").innerHTML=`<div class="course-home teacher-detail-page">
    <div class="stu-info-grid course-home-stats">
      <div class="stu-tile t-blue"><span>带班 · 学生</span><b>${sel.courseCount} 班 · ${sel.studentCount} 人</b></div>
      ${rateTile("出席率 · "+rt,sel.attRate,sel.attRate===null?"":`到 ${sel.att} / 缺 ${sel.abs}`)}
      ${rateTile("交作业率 · "+rt,sel.hwRate,sel.hwRate===null?"这段时间没布置过":`交 ${sel.hwIn} / 应交 ${sel.hwAssigned}`)}
      ${rateTile("批改率 · "+rt,sel.gradeRate,sel.gradeRate===null?"还没人交":`已改 ${sel.hwGraded} / 已交 ${sel.hwIn}`)}
    </div>
    <div class="student-detail-extra">
      <h4>TA 的课程（${sel.courseCount}）· 点进课程主页</h4>
      <div class="tt-class-chips">${sel.courses.map(c=>`<button class="tt-class-chip${isClassDone(c)?' archived':''}" data-course-home="${safeAttr(c.id)}" type="button">${esc(c.weekday)} ${esc(formatTimeCN(c.time))} · ${esc(c.className)}${isClassDone(c)?'（已结课）':''}</button>`).join("")||'<p class="empty">没有课程</p>'}</div>
    </div>
    <div class="student-detail-extra">
      <h4>TA 在带的学生（${sel.studentCount}）· 点名字看档案</h4>
      <div class="tt-stu-chips">${students.map(n=>`<button class="student-link tt-stu-chip" data-student-name="${safeAttr(n)}" type="button">${esc(n)}</button>`).join("")||'<p class="empty">还没有学生</p>'}</div>
    </div>
    <div class="student-detail-extra">
      <h4>📝 沟通笔记 · 老师资料</h4>
      <div class="tt-note-placeholder">跟这位老师的沟通交流、目前的任务、可编辑资料，都会放这里。这块要存云端、跨设备同步，得先在数据库加一个 <code>teachers</code> 字段（和你当初给学生加 <code>students</code> 字段一样，一行 SQL）。你点头我给你那行 SQL，跑完就能在这里记。</div>
    </div>
  </div>`;
  byId("teacherBack").addEventListener("click",()=>{teacherPanelSel="";render();});
  document.querySelectorAll("[data-course-home]").forEach(b=>b.addEventListener("click",()=>openCourseHome(b.dataset.courseHome)));
}

function bindTeacherPanelEvents(){
  document.querySelectorAll("[data-tt-type]").forEach(b=>b.addEventListener("click",()=>{teacherType=b.dataset.ttType;rerenderKeepScroll();}));
  document.querySelectorAll("[data-tt-term]").forEach(b=>b.addEventListener("click",()=>{teacherTerm=b.dataset.ttTerm;rerenderKeepScroll();}));
  const doneBtn=document.querySelector("[data-tt-done]");
  if(doneBtn)doneBtn.addEventListener("click",()=>{teacherShowDone=!teacherShowDone;rerenderKeepScroll();});
  bindDateRangeCtl("tp",(f,t)=>{teacherFrom=f;teacherTo=t;rerenderKeepScroll();});
  document.querySelectorAll("[data-teacher-pick]").forEach(b=>b.addEventListener("click",()=>{teacherPanelSel=b.dataset.teacherPick;render();}));
}

/* ===== 课程总览页 v2（v20260611f，Shirley 2026-06-11 深夜反馈）=====
   三组筛选：类别（LR/CW/CR/EW）× 学期（上半年/下半年/假期营/1对1）× 时间（本周/近3周/近4周/全部）。
   顶部所有数字（班级数/学生数/出席率/提交率/批改率）都按当前筛选实时算，不再固定显示总数。
   有记录的班排前面；这段时间没记录的班收进折叠区，一眼只看重点。 */
let courseOverviewType="all";   // all | LR | CW | CR | EW
let courseOverviewTerm="all";   // all | 上半年 | 下半年 | 假期营 | 1对1
let courseOverviewFrom="";      // 起始日期 yyyy-mm-dd，空 = 不限
let courseOverviewTo="";        // 结束日期，空 = 不限
let courseOverviewShowDone=false; // 是否把已结课的班算进来

/* 日期范围小工具：日历自选起止 + 快捷键（本周/上周/近4周/全部）
   课程总览页和单班主页共用，prefix 区分两套输入框 */
function isClassDone(c){return c.status==="Archived"||!!c.archivedAt;}

/* ===== 课程排期信息（v20260612c，Shirley："1 次记录"应写成已上到第几堂，
   还要一眼看到开课和结课日期）=====
   指定日期排课：开课=第一个日期，结课=最后一个日期，进度=已过的日期数；
   每周/一周多次：要填了开课日期才算，按总课数往后推，跳过停课日。
   返回 null = 没填排期，没法算。 */
function courseScheduleInfo(c){
  const todayKey=dateKey(new Date());
  const mode=repeatModeValue(c.repeatMode);
  const skips=skippedDates(c);
  if(mode==="dates"){
    const dates=repeatDatesFor(c).filter(d=>!skips.includes(d)).sort();
    if(!dates.length)return null;
    return {first:dates[0],last:dates[dates.length-1],done:dates.filter(d=>d<=todayKey).length,total:dates.length,mode};
  }
  const start=parseLocalDate(c.startDate);
  if(!start)return null;
  const total=Number(c.totalLessons)||20;
  // 从开课日起逐天找出 total 个有效上课日（停课日自动跳过）
  let day=new Date(start),done=0,count=0,last="",guard=0;
  while(count<total&&guard<total*7+120){
    if(occursByRule(c,day)){
      count++;last=dateKey(day);
      if(last<=todayKey)done++;
    }
    day=addDays(day,1);guard++;
  }
  if(!count)return null;
  return {first:dateKey(start),last,done,total:count,mode};
}

function courseProgressText(info){
  if(!info)return "";
  if(info.done>=info.total)return `全部 ${info.total} 堂已上完`;
  if(info.done<1)return `共 ${info.total} 堂 · 还没开课`;
  return `已上到第 ${info.done}/${info.total} 堂`;
}

/* 自动结课（v20260612c，Shirley：日期列表全部上完的班要自动出现"已结课"）：
   只对"指定日期"排课的班生效——日期全给了的班，最后一堂过了第二天就自动标已结课。
   每周排课的班不自动动它（总课数 20 是默认值，不一定是真实排期），还是手动结课。 */
function autoCloseFinishedClasses(){
  if(adminViewEmail)return;
  const todayKey=dateKey(new Date());
  let changed=false;
  scheduleData.forEach(c=>{
    if(c.status!=="Active")return;
    if(repeatModeValue(c.repeatMode)!=="dates")return;
    const info=courseScheduleInfo(c);
    if(info&&info.last&&info.last<todayKey){
      c.status="Archived";
      c.archivedAt=new Date().toISOString();
      changed=true;
    }
  });
  if(changed)saveSchedule();
}

/* 当前起止日期正好等于某个快捷键的范围时，把那个快捷键点亮
   （v20260612c，Shirley：按了本周/上周/本月/全部没有颜色，分不清按没按） */
function quickKeyFor(from,to){
  if(!from&&!to)return "clear";
  for(const v of ["week","lastweek","month"]){
    const [f,t]=quickRange(v);
    if(f===from&&t===to)return v;
  }
  return "";
}

function dateRangeCtlHtml(prefix,from,to){
  const quick=[["week","本周"],["lastweek","上周"],["month","本月"],["clear","全部"]];
  const cur=quickKeyFor(from,to);
  return `<span class="date-range-ctl">
    <input type="date" class="range-date" id="${prefix}From" value="${safeAttr(from)}" title="从哪天开始算">
    <i class="range-arrow">→</i>
    <input type="date" class="range-date" id="${prefix}To" value="${safeAttr(to)}" title="算到哪天">
    ${quick.map(([v,l])=>`<button class="tab range-quick ${cur===v?'active':''}" data-${prefix}-quick="${v}" type="button">${l}</button>`).join("")}
  </span>`;
}
function quickRange(v){
  const ws=weekStart();
  if(v==="week")return [dateKey(ws),dateKey(addDays(ws,6))];
  if(v==="lastweek")return [dateKey(addDays(ws,-7)),dateKey(addDays(ws,-1))];
  if(v==="month"){
    const now=new Date();
    const first=new Date(now.getFullYear(),now.getMonth(),1);
    const last=new Date(now.getFullYear(),now.getMonth()+1,0);
    return [dateKey(first),dateKey(last)];
  }
  return ["",""];
}
function bindDateRangeCtl(prefix,apply){
  const fromEl=byId(prefix+"From"),toEl=byId(prefix+"To");
  if(fromEl)fromEl.addEventListener("change",()=>apply(fromEl.value,toEl?toEl.value:""));
  if(toEl)toEl.addEventListener("change",()=>apply(fromEl?fromEl.value:"",toEl.value));
  document.querySelectorAll(`[data-${prefix}-quick]`).forEach(b=>b.addEventListener("click",()=>{
    const [f,t]=quickRange(b.dataset[prefix+"Quick"]);
    apply(f,t);
  }));
}
function rangeText(from,to){
  if(!from&&!to)return "全部时间";
  const ws=dateKey(weekStart()),we=dateKey(addDays(weekStart(),6));
  if(from===ws&&to===we)return "本周";
  const [lf,lt]=quickRange("lastweek");
  if(from===lf&&to===lt)return "上周";
  const [mf,mt]=quickRange("month");
  if(from===mf&&to===mt)return "本月";
  const fmt=s=>s?Number(s.slice(5,7))+"/"+Number(s.slice(8,10)):"";
  if(from&&to)return fmt(from)+"–"+fmt(to);
  return from?fmt(from)+" 起":"到 "+fmt(to);
}

function overviewCourses(){
  return scheduleData.filter(c=>c.status!=="Deleted"&&!c.deletedAt);
}

function rateChip(label,rate,sub){
  if(rate===null)return `<span class="ov-rate ov-rate-none"><span>${esc(label)}</span><b>—</b></span>`;
  const tone=rate>=80?"ov-rate-good":rate>=60?"ov-rate-mid":"ov-rate-bad";
  return `<span class="ov-rate ${tone}"><span>${esc(label)}</span><b>${rate}%</b>${sub?`<small>${esc(sub)}</small>`:""}</span>`;
}

function rateTile(label,rate,detail){
  if(rate===null)return `<div class="stu-tile no-val"><span>${esc(label)}</span><b>—</b><small class="ov-tile-detail">${esc(detail||"这段时间没记录")}</small></div>`;
  const tone=rate>=80?"ov-tile-good":rate>=60?"ov-tile-mid":"ov-tile-bad";
  return `<div class="stu-tile ${tone}"><span>${esc(label)}</span><b>${rate}%</b>${detail?`<small class="ov-tile-detail">${esc(detail)}</small>`:""}</div>`;
}

function courseOvRowHtml(c,s){
  const info=courseScheduleInfo(c);
  // 最后一列：能算出排期就显示"已上到第几堂 + 开课→结课"，没填排期就退回显示记录次数
  const progress=info
    ?`<span class="ov-lessons ov-progress"><b>${esc(isClassDone(c)?`共 ${info.total} 堂`:courseProgressText(info))}</b><small>${esc(formatDateShort(info.first))} 开课 · ${esc(formatDateShort(info.last))} 结课</small></span>`
    :`<span class="ov-lessons ov-progress"><b>${s.lessons} 次记录</b><small>未填排期</small></span>`;
  return `<button class="course-ov-row${s.lessons?"":" ov-row-quiet"}" data-course-home="${safeAttr(c.id)}" type="button">
    <span class="ov-name"><b>${esc(c.className)}${isClassDone(c)?'<i class="ov-done-tag">已结课</i>':""}</b><small>${esc(c.weekday)} ${esc(formatTimeCN(c.time))} · ${esc(c.teacher||"未填老师")} · ${esc(courseTypeLabel(c))} · ${esc(c.term||classTermLabel(c))}</small></span>
    <span class="ov-count">${(c.students||[]).length} 人</span>
    ${rateChip("出席",s.attRate,s.attRate===null?"":`到${s.att} 缺${s.abs}`)}
    ${rateChip("交作业",s.hwRate,s.hwRate===null?"":`${s.hwIn}/${s.hwAssigned}`)}
    ${rateChip("批改",s.gradeRate,s.gradeRate===null?"":`${s.hwGraded}/${s.hwIn}`)}
    ${progress}
  </button>`;
}

function renderCourses(){
  const allPool=overviewCourses();
  const doneCount=allPool.filter(isClassDone).length;
  const termIsDone=courseOverviewTerm==="结课"; // 学期筛选里选了"结课"=只看已结课的班
  // 选"结课"时强制把已结课的班纳进来；否则按"含已结课"开关决定
  const all=termIsDone?allPool:(courseOverviewShowDone?allPool:allPool.filter(c=>!isClassDone(c)));
  const codeOf=c=>courseCode(c)||"其他";
  const cats=["LR","CW","CR","EW","MV"];
  if(all.some(c=>codeOf(c)==="其他"))cats.push("其他");
  // 当前筛选下的班级
  const list=all.filter(c=>
    (courseOverviewType==="all"||codeOf(c)===courseOverviewType)&&
    (termIsDone?isClassDone(c):(courseOverviewTerm==="all"||classTermLabel(c)===courseOverviewTerm))
  );
  const since=courseOverviewFrom,until=courseOverviewTo;
  // 每班统计（按所选日期范围）+ 全选区汇总
  const agg={att:0,abs:0,hwAssigned:0,hwIn:0,hwGraded:0,lessons:0};
  const rows=list.map(c=>{
    const s=courseStats(c,since,until);
    agg.att+=s.att;agg.abs+=s.abs;agg.hwAssigned+=s.hwAssigned;agg.hwIn+=s.hwIn;agg.hwGraded+=s.hwGraded;agg.lessons+=s.lessons;
    return {c,s};
  });
  const aggAtt=(agg.att+agg.abs)?Math.round(agg.att/(agg.att+agg.abs)*100):null;
  const aggHw=agg.hwAssigned?Math.round(agg.hwIn/agg.hwAssigned*100):null;
  const aggGrade=agg.hwIn?Math.round(agg.hwGraded/agg.hwIn*100):null;
  // 学生数：只数当前筛选下的班，跨班重名只算一次
  const names=new Set();
  list.forEach(c=>(c.students||[]).forEach(s=>{if((s.name||"").trim())names.add(s.name.trim());}));
  // 排序：周一→周日 + 时间先后（Shirley：列表要按星期顺序，不要乱）
  const byWeekdayTime=(a,b)=>(WORKDAYS.indexOf(a.c.weekday)-WORKDAYS.indexOf(b.c.weekday))||(timeMinutes(a.c.time)-timeMinutes(b.c.time));
  // 有记录的排前面，没记录的收进折叠区；两组各自按星期+时间排
  const active=rows.filter(r=>r.s.lessons>0).sort(byWeekdayTime);
  const quiet=rows.filter(r=>!r.s.lessons).sort(byWeekdayTime);
  const rt=rangeText(since,until);
  const chip=(cur,val,label,key)=>`<button class="tab ${cur===val?'active':''}" data-${key}="${safeAttr(val)}" type="button">${esc(label)}</button>`;
  // 班级数徽章跟着当前筛选走（Shirley：选结课/LR/CW/时间，上面的"共 X 班"也要变，不能永远显示总数）
  setHead("课程","","共 "+list.length+" 班");
  byId("tabs").innerHTML="";
  byId("content").innerHTML=`<div class="course-home course-overview">
    <div class="ov-toolbar">
      <span class="ov-group"><i>类别</i>${chip(courseOverviewType,"all","全部","ov-type")}${cats.map(t=>chip(courseOverviewType,t,catLabel(t),"ov-type")).join("")}</span>
      <span class="ov-group"><i>学期</i>${chip(courseOverviewTerm,"all","全部","ov-term")}${TERM_OPTIONS.map(t=>chip(courseOverviewTerm,t,t,"ov-term")).join("")}${chip(courseOverviewTerm,"结课","结课"+(doneCount?" "+doneCount:""),"ov-term")}</span>
      <span class="ov-group"><button class="tab ov-done-toggle ${courseOverviewShowDone?'active':''}" data-ov-done type="button">含已结课${doneCount?" "+doneCount:""}</button></span>
      <span class="ov-group ov-group-time"><i>时间</i>${dateRangeCtlHtml("ov",since,until)}</span>
    </div>
    <div class="stu-info-grid course-home-stats ov-stats">
      <div class="stu-tile t-blue"><span>班级数</span><b>${list.length} 个班</b><small class="ov-tile-detail">${rows.length?agg.lessons+" 次课堂记录":"还没有班级"}</small></div>
      <div class="stu-tile t-green"><span>学生数（去重）</span><b>${names.size} 人</b><small class="ov-tile-detail">同名只算一次</small></div>
      ${rateTile("出席率 · "+rt,aggAtt,aggAtt===null?"":`到 ${agg.att} / 缺 ${agg.abs}`)}
      ${rateTile("交作业率 · "+rt,aggHw,aggHw===null?"这段时间没布置过":`交 ${agg.hwIn} / 应交 ${agg.hwAssigned}`)}
      ${rateTile("批改率 · "+rt,aggGrade,aggGrade===null?"还没人交":`已改 ${agg.hwGraded} / 已交 ${agg.hwIn}`)}
    </div>
    <div class="course-ov-list">${active.map(r=>courseOvRowHtml(r.c,r.s)).join("")||(quiet.length?`<p class="empty">${esc(rt)}内还没有课堂记录——这些班收在下面的折叠条里。</p>`:'<p class="empty">这个筛选下还没有班级。</p>')}</div>
    ${quiet.length?`<details class="ov-quiet-group"${active.length?"":" open"}><summary>${esc(rt)}内还没记录的班 · ${quiet.length} 个</summary><div class="course-ov-list ov-quiet-list">${quiet.map(r=>courseOvRowHtml(r.c,r.s)).join("")}</div></details>`:""}
    <p class="student-phase-hint">出席率 = 到 ÷（到+缺席）；提交率 = 已交+已批改 ÷ 应交；批改率 = 已批改 ÷ 已交。低于 60% 标红。已结课的班默认不算，点"含已结课"才算进来。</p>
  </div>`;
  document.querySelectorAll("[data-ov-type]").forEach(b=>b.addEventListener("click",()=>{courseOverviewType=b.dataset.ovType;rerenderKeepScroll();}));
  document.querySelectorAll("[data-ov-term]").forEach(b=>b.addEventListener("click",()=>{courseOverviewTerm=b.dataset.ovTerm;rerenderKeepScroll();}));
  const doneBtn=document.querySelector("[data-ov-done]");
  if(doneBtn)doneBtn.addEventListener("click",()=>{courseOverviewShowDone=!courseOverviewShowDone;rerenderKeepScroll();});
  bindDateRangeCtl("ov",(f,t)=>{courseOverviewFrom=f;courseOverviewTo=t;rerenderKeepScroll();});
  document.querySelectorAll("[data-course-home]").forEach(b=>b.addEventListener("click",()=>openCourseHome(b.dataset.courseHome)));
}

/* ===== SOP 流程页 v2（v20260611g，Shirley 反馈"难看难用"后重做）=====
   不再有编辑模式：每张卡底部常驻"写下一步 + 选页面 + 添加"，
   每个步骤行右侧有 ↑ ↓ ✕，点了立刻保存。好用优先。
   数据存 user_data.sop 列。 */
let sopNameEditId=null;  // 正在改名的工种卡 id

const SOP_PAGE_TAGS=["日程","话术","课程","学生","SOP","管理","课程详情","学生档案"];

function normalizeSopRole(x){
  x=x||{};
  return {
    id:x.id||uid("sop"),
    role:(x.role||"").trim()||"未命名工种",
    steps:Array.isArray(x.steps)?x.steps.map(s=>({id:s.id||uid("step"),text:(s.text||"").trim(),page:(s.page||"").trim()})).filter(s=>s.text):[],
    note:x.note||"",
    updatedAt:x.updatedAt||new Date().toISOString()
  };
}

function saveSop(){
  if(adminViewEmail)return;
  localStorage.setItem(STORAGE_KEYS.sop,JSON.stringify(sopData));
  syncToCloud();
}

function sopGuard(){
  if(adminViewEmail){showToast("正在查看他人数据，只能浏览不能修改");return false;}
  return true;
}

function sopCardHtml(r){
  const naming=sopNameEditId===r.id;
  const head=naming
    ?`<div class="sop-card-head"><input class="sop-name-input" id="sopName-${safeAttr(r.id)}" value="${safeAttr(r.role==="未命名工种"?"":r.role)}" placeholder="工种名，如 TA / 老师"><button class="btn primary sop-mini-btn" data-sop-save-name="${safeAttr(r.id)}" type="button">好</button></div>`
    :`<div class="sop-card-head"><h3>${esc(r.role)}</h3><span class="sop-head-ops"><button class="sop-op-btn" data-sop-rename="${safeAttr(r.id)}" type="button" title="改名">✏️</button><button class="sop-op-btn" data-sop-del-role="${safeAttr(r.id)}" type="button" title="删除整张卡">🗑</button></span></div>`;
  const steps=r.steps.length
    ?`<ol class="sop-steps">${r.steps.map((s,i)=>`<li class="sop-step-row">
        <span class="sop-step-text">${esc(s.text)}</span>
        ${s.page?`<i class="sop-page-tag">↳ ${esc(s.page)}</i>`:""}
        <span class="sop-step-ops">
          ${i>0?`<button class="sop-op-btn" data-sop-move="${safeAttr(r.id)}|${i}|-1" type="button" title="上移">↑</button>`:""}
          ${i<r.steps.length-1?`<button class="sop-op-btn" data-sop-move="${safeAttr(r.id)}|${i}|1" type="button" title="下移">↓</button>`:""}
          <button class="sop-op-btn sop-op-del" data-sop-del-step="${safeAttr(r.id)}|${i}" type="button" title="删掉这一步">✕</button>
        </span>
      </li>`).join("")}</ol>`
    :'<p class="empty sop-steps-empty">还没有步骤，在下面写第一步 ↓</p>';
  return `<section class="sop-card">
    ${head}
    ${steps}
    <div class="sop-add-row">
      <input class="sop-step-input" data-sop-step-input="${safeAttr(r.id)}" placeholder="写下一步要做什么，回车或点＋">
      <select class="sop-page-select" data-sop-page-input="${safeAttr(r.id)}"><option value="">页面(选填)</option>${SOP_PAGE_TAGS.map(p=>`<option value="${p}">${p}</option>`).join("")}</select>
      <button class="btn primary sop-mini-btn" data-sop-add-step="${safeAttr(r.id)}" type="button">＋</button>
    </div>
    <input class="sop-note-input" data-sop-note="${safeAttr(r.id)}" value="${safeAttr(r.note)}" placeholder="📌 心得 / 提醒（选填，写完点别处自动保存）">
  </section>`;
}

function sopAddStep(roleId){
  if(!sopGuard())return;
  const input=document.querySelector(`[data-sop-step-input="${roleId}"]`);
  const pageSel=document.querySelector(`[data-sop-page-input="${roleId}"]`);
  const text=(input&&input.value||"").trim();
  if(!text){showToast("先写这一步要做什么");return;}
  const r=sopData.find(x=>x.id===roleId);
  if(!r)return;
  r.steps.push({id:uid("step"),text:text,page:(pageSel&&pageSel.value)||""});
  r.updatedAt=new Date().toISOString();
  saveSop();
  render();
  // 渲染后把焦点放回同一张卡的输入框，连续添加不用动鼠标
  const again=document.querySelector(`[data-sop-step-input="${roleId}"]`);
  if(again)again.focus();
}

function renderSop(){
  setHead("SOP 流程","",sopData.length?("共 "+sopData.length+" 个工种"):"");
  byId("tabs").innerHTML=`<button class="btn primary" id="sopAddRole" type="button">＋ 新增工种</button>`;
  byId("content").innerHTML=`<div class="sop-page">
    ${sopData.map(sopCardHtml).join("")||`<div class="student-empty-hint sop-empty"><h3>把团队的做事流程写下来</h3><p>点左上"＋ 新增工种"建一张卡（比如「TA」），<br>然后在卡片底部一步一步往里加：开课前查什么、上课记什么、下课交什么。<br>写一步存一步，新同事来了照着做。</p></div>`}
  </div>`;
  byId("sopAddRole").addEventListener("click",()=>{
    if(!sopGuard())return;
    const r=normalizeSopRole({role:"未命名工种",steps:[]});
    sopData.push(r);
    sopNameEditId=r.id;
    saveSop();
    render();
    const input=byId("sopName-"+r.id);
    if(input)input.focus();
  });
  document.querySelectorAll("[data-sop-rename]").forEach(b=>b.addEventListener("click",()=>{sopNameEditId=b.dataset.sopRename;render();const i=byId("sopName-"+b.dataset.sopRename);if(i)i.focus();}));
  document.querySelectorAll("[data-sop-save-name]").forEach(b=>b.addEventListener("click",()=>{
    if(!sopGuard())return;
    const r=sopData.find(x=>x.id===b.dataset.sopSaveName);
    const input=byId("sopName-"+b.dataset.sopSaveName);
    if(!r||!input)return;
    r.role=input.value.trim()||"未命名工种";
    r.updatedAt=new Date().toISOString();
    sopNameEditId=null;
    saveSop();
    render();
  }));
  document.querySelectorAll("[data-sop-del-role]").forEach(b=>b.addEventListener("click",()=>{
    if(!sopGuard())return;
    const r=sopData.find(x=>x.id===b.dataset.sopDelRole);
    if(!r)return;
    askConfirm("删除「"+r.role+"」整张流程卡？",()=>{
      sopData=sopData.filter(x=>x.id!==r.id);
      saveSop();
      showToast("已删除");
      render();
    },{okText:"删除"});
  }));
  document.querySelectorAll("[data-sop-del-step]").forEach(b=>b.addEventListener("click",()=>{
    if(!sopGuard())return;
    const [id,idx]=b.dataset.sopDelStep.split("|");
    const r=sopData.find(x=>x.id===id);
    if(!r)return;
    r.steps.splice(Number(idx),1);
    r.updatedAt=new Date().toISOString();
    saveSop();
    render();
  }));
  document.querySelectorAll("[data-sop-move]").forEach(b=>b.addEventListener("click",()=>{
    if(!sopGuard())return;
    const [id,idx,dir]=b.dataset.sopMove.split("|");
    const r=sopData.find(x=>x.id===id);
    const i=Number(idx),j=i+Number(dir);
    if(!r||j<0||j>=r.steps.length)return;
    const t=r.steps[i];r.steps[i]=r.steps[j];r.steps[j]=t;
    r.updatedAt=new Date().toISOString();
    saveSop();
    render();
  }));
  document.querySelectorAll("[data-sop-add-step]").forEach(b=>b.addEventListener("click",()=>sopAddStep(b.dataset.sopAddStep)));
  document.querySelectorAll("[data-sop-step-input]").forEach(inp=>inp.addEventListener("keydown",e=>{
    if(e.key==="Enter"){e.preventDefault();sopAddStep(inp.dataset.sopStepInput);}
  }));
  document.querySelectorAll(".sop-name-input").forEach(inp=>inp.addEventListener("keydown",e=>{
    if(e.key==="Enter"){
      e.preventDefault();
      const btn=inp.parentElement.querySelector("[data-sop-save-name]");
      if(btn)btn.click();
    }
  }));
  // 心得/提醒：写完失焦自动保存
  document.querySelectorAll("[data-sop-note]").forEach(inp=>inp.addEventListener("change",()=>{
    if(!sopGuard())return;
    const r=sopData.find(x=>x.id===inp.dataset.sopNote);
    if(!r)return;
    r.note=inp.value.trim();
    r.updatedAt=new Date().toISOString();
    saveSop();
    showToast("已保存");
  }));
}

/* ===== 测试数据生成器（v20260611g）=====
   Shirley 要求：真实数据太少看不出 UI 效果，做一批仿真班级/学生来 test，
   看完一键清除。所有 id 以 "test-" 开头、名字以 "测试·" 开头，清除按这个认。 */
function importTestData(){
  const stuNames=["Amy","Ben","Coco","Derek","Ella","Felix","Gigi","Henry","Iris","Jack","Kiki","Leo","Mia","Nora","Oscar"];
  const schools=["光明小学","育才小学","实验学校","阳光国际学校","新城小学"];
  const cities=["上海","北京","深圳","新加坡","吉隆坡"];
  const grades=["三年级","四年级","五年级","六年级","初一"];
  const profiles=stuNames.map((n,i)=>normalizeStudentProfile({
    id:"test-stu-"+i,
    name:"测试·"+n,
    gender:i%2?"女":"男",
    birthday:(2013+i%5)+"-0"+(1+i%9)+"-1"+(i%9),
    grade:grades[i%grades.length],
    school:schools[i%schools.length],
    city:cities[i%cities.length],
    parentName:n+"妈妈",
    parentContact:"wx_"+n.toLowerCase(),
    enrollDate:"2026-0"+(1+i%3)+"-01",
    status:"在读",
    note:i===0?"性格活泼，课堂参与度高":""
  }));
  // [类别, 班名, 周几, 时间, 老师, 学期, 学生数, 有没有记录, 是否已结课]
  const specs=[
    ["LR","LR-3-4级 测试A班","周一","18:00","Teacher Chris","上半年",4,true,false],
    ["LR","LR-5-6级","周三","19:00","Teacher Joe","下半年",3,true,false],
    ["CW","CW-1-2级 测试班","周二","19:00","Teacher Tim","上半年",5,true,false],
    ["CW","CW-7-8级","周四","20:00","Teacher Alex","下半年",4,true,false],
    ["CR","中文趣味阅读 3级","周五","18:00","清滢老师","上半年",4,true,false],
    ["CR","中文趣味阅读 6级","周六","10:00","清滢老师","下半年",5,true,false],
    ["EW","EW-3-4级","周三","20:00","Teacher Ben","上半年",3,true,false],
    ["EW","EW-5-6级","周日","10:00","Teacher Ben","下半年",3,false,false],
    ["LR","Mia 1对1 精读","周五","21:00","Shirley","1对1",1,true,false],
    ["CW","假期写作营 A","周六","14:00","Teacher Louise","假期营",6,true,true]
  ];
  const hwContents=["读下一章并写批注","写 150 字小作文","完成阅读理解练习","背诵本课生词","修改上次作文"];
  const longRemark="测试·长表现示例：这节课主动举手五次，朗读流畅，对故事主旨的理解很到位。讨论环节能结合自己的生活经验发表看法，写作练习里用了两个新学的修辞。需要注意的是书写还有些急躁，个别字母大小写混用，已当堂提醒。建议家长本周陪读时让孩子复述一遍故事情节，巩固理解。";
  const remarks=["回答问题很积极","作业质量比上周进步","上课有点走神，已提醒","朗读进步明显",""];
  // 找到某个"周几"最近一次出现的日期，往前每 7 天一节课
  function datesFor(weekday,count){
    let d=new Date();
    for(let i=0;i<7;i++){if(WEEKDAYS[d.getDay()]===weekday)break;d=addDays(d,-1);}
    const out=[];
    for(let i=0;i<count;i++){out.push(dateKey(addDays(d,-7*i)));}
    return out;
  }
  let stuCursor=0;
  const classes=specs.map((sp,ci)=>{
    const [type,name,weekday,time,teacher,term,stuCount,hasRecords,done]=sp;
    const members=[];
    for(let k=0;k<stuCount;k++){members.push({name:profiles[(stuCursor+k)%profiles.length].name});}
    stuCursor+=stuCount;
    const records=[];
    if(hasRecords){
      datesFor(weekday,6).forEach((date,ri)=>{
        const attendance={},hwEntries={};
        members.forEach((m,mi)=>{
          const roll=(ci*7+ri*3+mi)%10;
          if(roll<7)attendance[m.name]={status:"到",tag:roll===6?"迟到":"",remark:(ri===0&&mi===0)?longRemark:remarks[(ci+ri+mi)%remarks.length]};
          else if(roll<9)attendance[m.name]={status:"缺席",tag:roll===8?"请假":"",remark:roll===8?"家里有事提前请了假":""};
          else attendance[m.name]={status:"到",tag:"",remark:""};
          const h=(ci+ri*2+mi)%10;
          hwEntries[m.name]={state:h<5?"已批改":h<8?"已交":"未交",score:h<3?["A","A-","B+"][h]:""};
        });
        const rec={date:date,attendance:attendance};
        if(ri%3!==2)rec.homework={content:hwContents[(ci+ri)%hwContents.length],assignedAt:date,entries:hwEntries};
        if(ri===1)rec.notes="测试·课堂笔记：今天讲完第三章，下周小测。";
        records.push(rec);
      });
    }
    return normalizeClassItem({
      id:"test-cls-"+ci,
      weekday:weekday,time:time,teacher:teacher,
      courseType:type,className:"测试·"+name,
      term:term,status:done?"Archived":"Active",
      archivedAt:done?new Date().toISOString():"",
      zoomLabel:"zoom"+(ci%3+1),totalLessons:"20",
      students:members,classRecords:records
    });
  });
  // 排期信息（v20260612c）：让测试班能展示"已上到第几堂 / 开课→结课 / 休息日 / 自动结课"
  classes.forEach((c,ci)=>{
    if(ci===9){
      // 假期营：指定日期排课，10 堂全在过去 → 进系统后自动标已结课（演示自动结课）
      c.repeatMode="dates";
      c.repeatDates=datesFor(c.weekday,10).sort();
      c.status="Active";c.archivedAt="";
    }else if(ci===8){
      // 1对1：指定日期排课，上到一半，往后排 4 堂，其中一堂标休息
      const past=datesFor(c.weekday,4).sort();
      const lastPast=parseLocalDate(past[past.length-1]);
      const future=[7,14,21,28].map(n=>dateKey(addDays(lastPast,n)));
      c.repeatMode="dates";
      c.repeatDates=past.concat(future);
      c.skippedDates=[future[1]];
    }else if(ci===7){
      // 还没开课的班：开课日期在下周 → 显示"还没开课"
      c.startDate=dateKey(addDays(parseLocalDate(datesFor(c.weekday,1)[0]),7));
    }else{
      // 每周班：8 周前开课，共 20 堂 → 已上到第 8/20 堂左右
      c.startDate=datesFor(c.weekday,8).sort()[0];
    }
  });
  const sopCards=[
    {id:"test-sop-0",role:"测试·TA",steps:[
      {text:"开课前 15 分钟检查 Zoom 链接和录制",page:"日程"},
      {text:"上课点名，缺席的标请假或缺席",page:"课程详情"},
      {text:"下课前布置作业并登记",page:"课程详情"},
      {text:"周五查本周出席率和交作业率",page:"课程"}
    ]},
    {id:"test-sop-1",role:"测试·班主任",steps:[
      {text:"每周一查上周缺勤学生，联系家长",page:"学生"},
      {text:"新生入学先建档案",page:"学生档案"}
    ]}
  ].map(normalizeSopRole);
  // 防御：normalizeSopRole 会生成新 id，这里要保住 test- 前缀
  sopCards[0].id="test-sop-0";sopCards[1].id="test-sop-1";
  scheduleData=[...scheduleData,...classes];
  studentsData=[...studentsData,...profiles];
  sopData=[...sopData,...sopCards];
  saveSchedule();saveStudents();saveSop();
}
