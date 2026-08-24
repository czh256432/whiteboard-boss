export type Scores={video:number;edit:number;promo:number;aesthetic:number;final:number};
export type Evaluation={id:string;label:string;date:string;evaluator:string;scores:Scores;growth:number;independence:number;professionalism:number;interventions:number};
export type Task={id:string;date:string;title:string;project:string;category:string;passed:boolean;usable:number;generated:number};
export type Problem={id:string;title:string;type:string;severity:"低"|"中"|"高"|"严重";repeats:number;solved:boolean};
export type Intern={id:string;name:string;role:string;mentor:string;mentors:string[];startDate:string;avatar:string;evaluations:Evaluation[];tasks:Task[];problems:Problem[];highlights:string[]};
export const defaultSettings={minRetention:75};
export type Settings=typeof defaultSettings;

const names=["林澈","许昭","乔安","沈汐","顾言","陆遥","苏禾","程野","江月","周屿"];
const palettes=["#002FA7","#1254CC","#246BFD","#1746A2","#0C4A9E","#3764D6","#1B4FBA","#003B8F","#2A5BCE","#153E90"];
const baseline=[[58,64,52,68,58],[84,82,76,86,82],[62,78,55,91,70],[73,89,59,76,78],[88,68,74,79,80],[51,57,49,61,54],[77,74,70,82,73],[68,82,65,59,69],[65,67,61,70,64],[43,48,39,52,45]];
const current=[[87,84,80,86,84],[96,95,92,96,95],[75,84,70,94,79],[82,92,68,82,86],[93,75,81,84,85],[74,72,69,78,72],[81,78,73,85,77],[76,88,70,66,75],[68,69,64,72,66],[50,53,44,55,48]];
const scores=(a:number[]):Scores=>({video:a[0],edit:a[1],promo:a[2],aesthetic:a[3],final:a[4]});

export const seedInterns:Intern[]=names.map((name,i)=>({
 id:`intern-${i+1}`,name,role:"AI漫剧制作实习生",mentor:i%2?"于勒":"何主管",mentors:[i%2?"于勒":"何主管"],startDate:`2026-08-${String(1+i).padStart(2,"0")}`,avatar:palettes[i],
 evaluations:[
  {id:`b-${i}`,label:"Day 1 基线",date:"2026-08-01",evaluator:i%2?"于勒":"何主管",scores:scores(baseline[i]),growth:55+i*2,independence:48+i*3,professionalism:76+i%4*4,interventions:5.2-i*.18},
  {id:`c-${i}`,label:"第 5 次复评",date:"2026-08-16",evaluator:i%3?"于勒":"何主管",scores:scores(current[i]),growth:i===1?95:92-i*4,independence:i===1?94:i===4?61:88-i*3,professionalism:i===1?96:i===6?66:84+i%3*3,interventions:i===4?4.3:Math.max(1.1,3.1-i*.16)}
 ],
 tasks:Array.from({length:6},(_,j)=>({id:`t-${i}-${j}`,date:`2026-08-${String(19+j).padStart(2,"0")}`,title:["纯侧面打戏镜头","20秒剧情剪辑","角色一致性复测","剧情钩子剧宣","情绪特写生成","成片交付"][j],project:j%3===0?"星际病院":j%3===1?"魔尊鼠鼠":"海底奇观",category:["资产图片","成片集数","资产图片","剧宣预告","资产图片","成片集数"][j],passed:j<Math.max(1,5-Math.floor(i/2)),usable:6-j%2,generated:8+j})),
 problems:i===6?[{id:`p-${i}`,title:"人物发型一致性反复偏移",type:"人物一致性",severity:"高",repeats:6,solved:false}]:i>7?[{id:`p-${i}`,title:"反馈后仍出现镜头角度错误",type:"镜头",severity:i===9?"严重":"中",repeats:3+i-8,solved:false}]:i===4?[{id:`p-${i}`,title:"负责人介入频率偏高",type:"效率",severity:"中",repeats:4,solved:false}]:[],
 highlights:i<6?[i===0?"两周内视频生成提升 29 分":"复杂镜头能够稳定交付","主动沉淀可复用工作流"]:["按时完成阶段任务"]
}));

export const newIntern=(name:string,mentor:string):Intern=>({id:crypto.randomUUID(),name,mentor,mentors:mentor?[mentor]:[],role:"AI漫剧制作实习生",startDate:new Date().toISOString().slice(0,10),avatar:"#002FA7",evaluations:[],tasks:[],problems:[],highlights:[]});
export function production(s:Scores){return (s.video*.2+s.edit*.15+s.promo*.1+s.aesthetic*.1+s.final*.05)/.6}
export function problemPenalty(i:Intern){const unit={"低":.5,"中":1,"高":2,"严重":4};return Math.min(25,i.problems.reduce((sum,p)=>sum+(p.solved?.25:1)*unit[p.severity]*Math.max(1,p.repeats),0))}
export function metrics(i:Intern,settings:Settings){
 if(!i.evaluations.length)return{unrated:true,prod:0,baseProd:0,overall:0,risk:0,penalty:0,retention:0,grade:"待",passRate:0,intervention:0,management:"待评估",eligible:false};
 const first=i.evaluations[0],last=i.evaluations.at(-1)!;const prod=production(last.scores),baseProd=production(first.scores),rawOverall=prod*.6+last.growth*.15+last.independence*.15+last.professionalism*.1,penalty=problemPenalty(i),overall=Math.max(0,rawOverall-penalty);
 const retention=Math.max(0,Math.min(100,rawOverall*.75+last.growth*.15+last.independence*.1-penalty));let grade=retention>=90&&prod>=90?"A":retention>=82&&prod>=80?"B":retention>=72&&prod>=70?"C":retention>=60?"D":"E";if(prod<70&&["A","B"].includes(grade))grade="C";
 const passRate=i.tasks.length?i.tasks.filter(t=>t.passed).length/i.tasks.length*100:0,intervention=last.interventions,management=intervention<1.5?"低":intervention<2.5?"较低":intervention<3.5?"中等":intervention<4.5?"较高":"高";
 return{unrated:false,prod,baseProd,overall,risk:penalty,penalty,retention,grade,passRate,intervention,management,eligible:["A","B","C"].includes(grade)&&retention>=settings.minRetention};
}
export function reasons(i:Intern,settings:Settings){const m=metrics(i,settings);if(m.unrated)return["尚未完成首次统一评估，当前不参与评级和留用排名","请完成 AI视频、剪辑、剧宣、审美、成片质量五项评分"];const first=i.evaluations[0],last=i.evaluations.at(-1)!;const risk=m.penalty>0?`问题复发按严重度自动扣除 ${m.penalty.toFixed(1)} 分`:"当前没有问题复发扣分";if(m.eligible)return[`AI视频由 ${first.scores.video} 提升至 ${last.scores.video}，提升 ${last.scores.video-first.scores.video} 分`,`留用指数 ${m.retention.toFixed(1)} 分，达到留用门槛 ${settings.minRetention} 分`,risk];return[`当前核心生产能力 ${m.prod.toFixed(1)} 分`,`留用指数 ${m.retention.toFixed(1)} 分${m.retention<settings.minRetention?`，低于门槛 ${settings.minRetention} 分`:""}`,risk]}
