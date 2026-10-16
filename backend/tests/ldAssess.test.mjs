import { drawQuestions, gradeAttempt, makeOptionOrders, publicQuestions, unmapAnswers } from '../utils/ldAssess.js';
import assert from 'node:assert';
const qs = Array.from({length: 60}, (_, i) => ({ id: 'Q'+i, type: i%7===0?'multi':'mcq', text: 'q'+i, options: ['a','b','c','d'], correct: i%7===0?[0,2]:[1], topic: 'ABCDEF'[i%6], critical: i%10===0 }));
const d1 = drawQuestions(qs, 20); assert.equal(d1.length, 20); assert.equal(new Set(d1).size, 20);
const seen = Object.fromEntries(d1.map(id => [id, 1]));
const d2 = drawQuestions(qs, 20, seen);
const overlap = d2.filter(id => seen[id]).length; console.log('overlap attempt2 vs 1:', overlap, 'criticals:', d2.filter(id=>qs.find(q=>q.id===id).critical).length);
assert(overlap <= 6, 'mostly unseen');
// boundary: 20 questions, 18 right = 90 pass, 17 right = 85 fail
const mk = (right, critWrong=false) => { const ord = d1.slice(); const ans = {}; ord.forEach((id,i)=>{ const q=qs.find(x=>x.id===id); const ok=i<right; ans[id]= q.type==='multi'? (ok?[0,2]:[1]) : (ok?1:0); }); return gradeAttempt(qs, ord, ans, {passScore:90}); };
const r18 = mk(18); console.log('18/20', r18.score, r18.passed, 'critfail', r18.criticalFailed);
const r17 = mk(17); assert.equal(r17.passed, false);
// 89.96 case: 1000 points, 899.6? use points weights
const wq = [{id:'a',type:'mcq',text:'x',options:['1','2'],correct:[0],points:8996},{id:'b',type:'mcq',text:'y',options:['1','2'],correct:[0],points:1004}];
const g = gradeAttempt(wq,['a','b'],{a:0,b:1},{passScore:90}); console.log('89.96 ->', g.score, g.passed); assert.equal(g.passed,false); assert.equal(g.score,89.9);
// critical rule
const cq=[...Array(19)].map((_,i)=>({id:'n'+i,type:'mcq',text:'n',options:['1','2'],correct:[0]})).concat([{id:'c',type:'mcq',text:'crit',options:['1','2'],correct:[0],critical:true}]);
const ans=Object.fromEntries(cq.map(q=>[q.id, q.id==='c'?1:0])); // 95% but critical wrong
const gc=gradeAttempt(cq,cq.map(q=>q.id),ans,{passScore:90}); console.log('95% crit wrong ->',gc.score,gc.passed); assert.equal(gc.passed,false);
assert.equal(gradeAttempt(cq,cq.map(q=>q.id),ans,{passScore:90,criticalRule:false}).passed,true);
// multi partial
const m=[{id:'m',type:'multi',text:'m',options:['1','2','3'],correct:[0,1]}]; assert.equal(gradeAttempt(m,['m'],{m:[0]},{passScore:90}).passed,false);
// option shuffle roundtrip
const oo = makeOptionOrders(qs, d1, true); const pub = publicQuestions(qs, d1, oo);
const q0 = qs.find(q=>q.id===d1[0]); const shownIdx = pub[0].options.indexOf(q0.options[q0.correct[0]]);
const back = unmapAnswers({[q0.id]: q0.type==='multi'? q0.correct.map(c=>pub[0].options.indexOf(q0.options[c])) : shownIdx}, oo);
assert.equal(gradeAttempt(qs,[q0.id],back,{passScore:90}).passed,true);
console.log('ALL OK');
