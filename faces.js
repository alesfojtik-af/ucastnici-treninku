// 30 kreslených obličejů (15 mužů, 15 žen) pro avatary hráčů.
const SKIN=["#F9DEC9","#F3CDB0","#EDBE9C"];
const HAIR={blond:"#E2BE62",hnede:"#9A6A3C",tmave:"#5A3A22",cerne:"#2B2220",zrzave:"#C4622D",sedive:"#BDB7AF"};
const BG=["#BFE6EC","#F6E1B5","#CDE7D5","#F7D3C6","#D9DDF3","#F2E6CF"];
const FACES=[
 ["m","short","hnede",0],["m","short","blond",1,"sun"],["m","spiky","blond",0],["m","side","tmave",1,"gl"],["m","curly","hnede",2],
 ["m","bald","hnede",1,"beard"],["m","buzz","cerne",0,"beard"],["m","cap","blond",0],["m","longm","hnede",2],["m","short","zrzave",0,"beard"],
 ["m","side","sedive",1,"gl beard"],["m","cap2","hnede",2,"sun"],["m","curly","blond",0],["m","spiky","cerne",1,"must"],["m","bald","sedive",0,"gl"],
 ["f","long","blond",0],["f","long","hnede",1,"sun"],["f","bob","cerne",0],["f","pony","blond",1],["f","bun","hnede",0],
 ["f","curlyf","zrzave",0],["f","pixie","blond",2],["f","long","tmave",2,"band"],["f","bob","zrzave",1,"gl"],["f","pony","hnede",0,"sun"],
 ["f","bun","sedive",1,"gl"],["f","long","zrzave",0,"ear"],["f","curlyf","hnede",2],["f","pixie","cerne",0,"ear"],["f","long","blond",1,"band"]
];
function face(i){
  const [sex,style,hc,sk,ex=""]=FACES[i], h=HAIR[hc], s=SKIN[sk], bg=BG[i%BG.length];
  const shirt=["#0B7A86","#F4A51C","#D9512C","#2E8B57","#3F5AA8","#8E44AD"][i%6];
  let back="", front="";
  const curls=(pts,r)=>pts.map(([x,y])=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${h}"/>`).join("");
  switch(style){
    case "short": front=`<path d="M13.5 21Q13 9.5 24 9.5Q35 9.5 34.5 21Q31 14 24 14.5Q17 14 13.5 21Z" fill="${h}"/>`;break;
    case "spiky": front=`<path d="M14 19L14.5 11L18 13.5L20 8L23 12L26 7L28 12L31 9L32 14L34 12L34 19Q30 15 24 15Q18 15 14 19Z" fill="${h}"/>`;break;
    case "side": front=`<path d="M13.5 22Q12 9 25 9Q36 10 34.5 20Q28 13 19 16Q16 18 13.5 22Z" fill="${h}"/>`;break;
    case "curly": front=curls([[15,18],[17,13],[21,10.5],[26,10],[30,11.5],[33,15],[34,19]],4);break;
    case "bald": front=`<path d="M13.6 24Q13 18 15.5 16.5L15.5 24Z M34.4 24Q35 18 32.5 16.5L32.5 24Z" fill="${h}"/>`;break;
    case "buzz": front=`<path d="M14 19Q14 10.5 24 10.5Q34 10.5 34 19Q30 14.5 24 14.5Q18 14.5 14 19Z" fill="${h}" opacity=".75"/>`;break;
    case "cap": case "cap2": { const c=style==="cap"?"#0B7A86":"#D9512C";
      front=`<path d="M13.5 21Q14 16 16 16L16 21Z M34.5 21Q34 16 32 16L32 21Z" fill="${h}"/><path d="M13 17.5Q13 7.5 24 7.5Q35 7.5 35 17.5Z" fill="${c}"/><path d="M24 16.5L41 17.2Q41.5 19.6 34 19.6L24 18.8Z" fill="${c}"/><circle cx="24" cy="8" r="1.2" fill="#fff"/>`;break;}
    case "longm": back=`<path d="M12 23Q11 8 24 8Q37 8 36 23L36 31L12 31Z" fill="${h}"/>`; front=`<path d="M13.5 21Q14 10 24 10Q34 10 34.5 21Q30 13.5 24 14Q18 13.5 13.5 21Z" fill="${h}"/>`;break;
    case "long": back=`<path d="M11 24Q10 7 24 7.5Q38 7 37 24L38.5 41L9.5 41Z" fill="${h}"/>`; front=`<path d="M13.5 22Q14 10 24 10Q34 10 34.5 22Q31 13 23 14Q17 15.5 13.5 22Z" fill="${h}"/>`;break;
    case "bob": back=`<path d="M11.5 22Q11 8 24 8Q37 8 36.5 22L37 31Q34 32 33 29L15 29Q14 32 11 31Z" fill="${h}"/>`; front=`<path d="M14 19Q14 10 24 10Q34 10 34 19L34 17Q24 12.5 14 17Z" fill="${h}"/>`;break;
    case "pony": back=`<ellipse cx="37" cy="25" rx="3.6" ry="9" fill="${h}" transform="rotate(-12 37 25)"/>`; front=`<path d="M13.5 21Q13 9.5 24 9.5Q35 9.5 34.5 21Q31 13.5 24 14Q17 14 13.5 21Z" fill="${h}"/><circle cx="34" cy="16" r="1.6" fill="#D9512C"/>`;break;
    case "bun": back=`<circle cx="24" cy="7" r="5" fill="${h}"/>`; front=`<path d="M13.5 21Q13 9.5 24 9.5Q35 9.5 34.5 21Q31 13.5 24 14Q17 14 13.5 21Z" fill="${h}"/>`;break;
    case "curlyf": back=curls([[12,20],[12,27],[13,33],[36,20],[36,27],[35,33]],4.2); front=curls([[14.5,17],[17,12.5],[21,10],[26,9.5],[30,11],[33,14.5],[34,18.5]],4.2);break;
    case "pixie": front=`<path d="M13.5 23Q12 9 24 9Q36 9 34.5 21Q33 15 27 14Q22 18 15 18Q14 20 13.5 23Z" fill="${h}"/>`;break;
  }
  const eyes=ex.includes("sun")?`<rect x="16.5" y="20.5" width="6.5" height="4.2" rx="1.8" fill="#1E2A2E"/><rect x="25" y="20.5" width="6.5" height="4.2" rx="1.8" fill="#1E2A2E"/><path d="M23 22H25" stroke="#1E2A2E" stroke-width="1"/>`
    :`<circle cx="20" cy="23" r="1.3" fill="#2B2B2B"/><circle cx="28" cy="23" r="1.3" fill="#2B2B2B"/>`;
  const gl=ex.includes("gl")?`<circle cx="20" cy="23" r="3.1" fill="none" stroke="#1E2A2E" stroke-width="1"/><circle cx="28" cy="23" r="3.1" fill="none" stroke="#1E2A2E" stroke-width="1"/><path d="M23.1 23H24.9" stroke="#1E2A2E" stroke-width="1"/>`:"";
  const beard=ex.includes("beard")?`<path d="M14.5 24Q15.5 36.5 24 36.5Q32.5 36.5 33.5 24Q31.5 31 24 31Q16.5 31 14.5 24Z" fill="${h}"/>`:"";
  const must=ex.includes("must")?`<path d="M20 28.2Q24 26.3 28 28.2Q24 27.6 20 28.2Z" fill="${h}" stroke="${h}" stroke-width="1"/>`:"";
  const band=ex.includes("band")?`<path d="M13.6 17.5Q24 9 34.4 17.5" fill="none" stroke="#F4A51C" stroke-width="2.4"/>`:"";
  const ear=ex.includes("ear")?`<circle cx="13.6" cy="26.5" r="1.2" fill="#F4A51C"/><circle cx="34.4" cy="26.5" r="1.2" fill="#F4A51C"/>`:"";
  const mouth=`<path d="M20.5 28.6Q24 31.6 27.5 28.6" fill="none" stroke="${sex==="f"?"#C0504D":"#7A4A3A"}" stroke-width="1.3" stroke-linecap="round"/>`;
  const cheeks=sex==="f"?`<circle cx="17.8" cy="27" r="1.5" fill="#F29C8F" opacity=".45"/><circle cx="30.2" cy="27" r="1.5" fill="#F29C8F" opacity=".45"/>`:"";
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="${bg}"/>${back}
    <path d="M7 48Q8 37 24 36.5Q40 37 41 48Z" fill="${shirt}"/><rect x="21" y="31" width="6" height="6" fill="${s}"/>
    <circle cx="14" cy="23.5" r="2.5" fill="${s}"/><circle cx="34" cy="23.5" r="2.5" fill="${s}"/>
    <ellipse cx="24" cy="22.5" rx="10" ry="11.5" fill="${s}"/>${cheeks}${eyes}${gl}${beard}${must}${mouth}${front}${band}${ear}</svg>`;
}
