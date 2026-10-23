const D=require('../lib/data'); const {batch}=require('./sim');
for (const pm of [7,6,5,4]) { D.PEAK_MAX=pm; for (const [l,P] of [['moyens',{}],['faibles',{skillMean:0.7}]]) { const b=batch(P,400,'mix'); console.log('pic<=',pm,l.padEnd(8),'s1',b.s1.toFixed(2),'3★',b.p3.toFixed(2),'0★',b.p0.toFixed(2)); } }
