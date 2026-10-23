const D=require('../lib/data'); const {batch}=require('./sim');
const f=(l,P,strat)=>{const b=batch(P,400,strat);console.log(l.padEnd(26),'s1',b.s1.toFixed(2),'s2',b.s2.toFixed(2),'s3',b.s3.toFixed(2),'3★',b.p3.toFixed(2),'0★',b.p0.toFixed(2),'fete3',b.fete3.toFixed(2),'med',Math.round(b.bankMed));};
const F=JSON.parse(JSON.stringify(D.FETE));
for (const [n,y3] of [['4/2 (actuel)',{perFarm:4,mixed:2}],['3/2',{perFarm:3,mixed:2}],['3/1',{perFarm:3,mixed:1}]]) {
  D.FETE[2]=y3; f('fete an3 '+n+' moyens',{}); f('  faibles',{skillMean:0.7}); f('  forts',{skillMean:1}); f('  6 equipes',{teams:6});
}
