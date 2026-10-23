const {batch}=require('./sim');
const f=(l,P)=>{const b=batch(P,400);console.log(l.padEnd(10),'s1',b.s1.toFixed(2),'s2',b.s2.toFixed(2),'s3',b.s3.toFixed(2),'3★',b.p3.toFixed(2),'0★',b.p0.toFixed(2),'fete3',b.fete3.toFixed(2),'med',Math.round(b.bankMed));};
f('moyens',{});f('faibles',{skillMean:0.7});f('forts',{skillMean:1});f('6 equipes',{teams:6});
