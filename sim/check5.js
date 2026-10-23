const {batch}=require('./sim');
for (const m of [2.3,2.4]) for (const [l,P] of [['moyens',{}],['faibles',{skillMean:0.7}],['forts',{skillMean:1}]]) {const b=batch(Object.assign({s3mult:m},P),300);console.log(m,l.padEnd(8),'3★',b.p3.toFixed(2),'med',Math.round(b.bankMed));}
