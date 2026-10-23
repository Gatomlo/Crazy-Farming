const D=require('../lib/data');const {batch}=require('./sim');
for (const [sp,dp,fee] of [[7,14,10],[8,16,10],[9,18,15],[10,20,15]]) {
  D.MARKET.superPrice=sp;D.MARKET.directPrice=dp;D.MARKET.stallFee=fee;
  for (const [l,P] of [['moyens',{}],['faibles',{skillMean:0.7}],['forts',{skillMean:1}]]) {
    const b=batch(P,300);console.log(`${sp}/${dp}/${fee}`,l.padEnd(8),'s1',b.s1.toFixed(2),'s2',b.s2.toFixed(2),'s3',b.s3.toFixed(2),'3★',b.p3.toFixed(2),'med',Math.round(b.bankMed));
  }
}
