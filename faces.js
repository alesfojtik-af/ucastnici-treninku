// Avatary hráčů: 30 kreslených lidí (15 mužů, 15 žen, různé výrazy) a 20 zvířátek.
// Index avataru je uložený v databázi, proto se pořadí nesmí měnit (nové kusy jen na konec).
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
  if(i>=FACES.length) return animal(i-FACES.length);
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
  const xp=i%6; // výraz: 0 úsměv se zuby, 1 jazyk, 2 mrk, 3 údiv, 4 šibal, 5 smích
  const eyes=ex.includes("sun")?`<rect x="16.5" y="20.5" width="6.5" height="4.2" rx="1.8" fill="#1E2A2E"/><rect x="25" y="20.5" width="6.5" height="4.2" rx="1.8" fill="#1E2A2E"/><path d="M23 22H25" stroke="#1E2A2E" stroke-width="1"/>`
    :xp===2?`<circle cx="20" cy="23" r="1.4" fill="#2B2B2B"/><path d="M26 23.2Q28 21.6 30 23.2" fill="none" stroke="#2B2B2B" stroke-width="1.3" stroke-linecap="round"/>`
    :xp===5?`<path d="M18 23.5Q20 21.5 22 23.5M26 23.5Q28 21.5 30 23.5" fill="none" stroke="#2B2B2B" stroke-width="1.3" stroke-linecap="round"/>`
    :xp===3?`<circle cx="20" cy="22.8" r="1.9" fill="#fff" stroke="#2B2B2B" stroke-width=".6"/><circle cx="28" cy="22.8" r="1.9" fill="#fff" stroke="#2B2B2B" stroke-width=".6"/><circle cx="20" cy="23" r="1" fill="#2B2B2B"/><circle cx="28" cy="23" r="1" fill="#2B2B2B"/>`
    :`<circle cx="20" cy="23" r="1.4" fill="#2B2B2B"/><circle cx="28" cy="23" r="1.4" fill="#2B2B2B"/><circle cx="20.5" cy="22.5" r=".45" fill="#fff"/><circle cx="28.5" cy="22.5" r=".45" fill="#fff"/>`;
  const brows=xp===4?`<path d="M17.5 19.5L22 20.3M26 19.2Q28.5 17.4 30.5 18.8" fill="none" stroke="${h}" stroke-width="1.2" stroke-linecap="round"/>`:xp===3?`<path d="M17.8 18.6Q20 17.4 22.2 18.6M25.8 18.6Q28 17.4 30.2 18.6" fill="none" stroke="${h}" stroke-width="1.1" stroke-linecap="round"/>`:"";
  const gl=ex.includes("gl")?`<circle cx="20" cy="23" r="3.1" fill="none" stroke="#1E2A2E" stroke-width="1"/><circle cx="28" cy="23" r="3.1" fill="none" stroke="#1E2A2E" stroke-width="1"/><path d="M23.1 23H24.9" stroke="#1E2A2E" stroke-width="1"/>`:"";
  const beard=ex.includes("beard")?`<path d="M14.5 24Q15.5 36.5 24 36.5Q32.5 36.5 33.5 24Q31.5 31 24 31Q16.5 31 14.5 24Z" fill="${h}"/>`:"";
  const must=ex.includes("must")?`<path d="M20 28.2Q24 26.3 28 28.2Q24 27.6 20 28.2Z" fill="${h}" stroke="${h}" stroke-width="1"/>`:"";
  const band=ex.includes("band")?`<path d="M13.6 17.5Q24 9 34.4 17.5" fill="none" stroke="#F4A51C" stroke-width="2.4"/>`:"";
  const ear=ex.includes("ear")?`<circle cx="13.6" cy="26.5" r="1.2" fill="#F4A51C"/><circle cx="34.4" cy="26.5" r="1.2" fill="#F4A51C"/>`:"";
  const lip=sex==="f"?"#C0504D":"#7A4A3A";
  const mouth=xp===0?`<path d="M20 28Q24 33 28 28Z" fill="#7A2E2E"/><path d="M20.6 28.4H27.4L27 29.3H21Z" fill="#fff"/>`
    :xp===1?`<path d="M20.5 28.4Q24 31.2 27.5 28.4" fill="none" stroke="${lip}" stroke-width="1.3" stroke-linecap="round"/><path d="M23 29.6Q24.2 33.4 25.6 29.6Z" fill="#E86B7A"/>`
    :xp===3?`<ellipse cx="24" cy="29.4" rx="1.8" ry="2.2" fill="#7A2E2E"/>`
    :xp===4?`<path d="M21 29.4Q25 30.6 27.8 27.8" fill="none" stroke="${lip}" stroke-width="1.3" stroke-linecap="round"/>`
    :xp===5?`<path d="M19.6 27.6Q24 34 28.4 27.6Z" fill="#7A2E2E"/><path d="M21.5 31.2Q24 32.8 26.5 31.2" fill="none" stroke="#E86B7A" stroke-width="1.4"/>`
    :`<path d="M20.5 28.6Q24 31.6 27.5 28.6" fill="none" stroke="${lip}" stroke-width="1.3" stroke-linecap="round"/>`;
  const freck=i%4===1&&!ex.includes("beard")?`<g fill="#C98B6B" opacity=".55"><circle cx="18" cy="26.6" r=".45"/><circle cx="19.4" cy="27.4" r=".45"/><circle cx="30" cy="26.6" r=".45"/><circle cx="28.6" cy="27.4" r=".45"/></g>`:"";
  const cheeks=sex==="f"||xp===5?`<circle cx="17.8" cy="27" r="1.5" fill="#F29C8F" opacity=".45"/><circle cx="30.2" cy="27" r="1.5" fill="#F29C8F" opacity=".45"/>`:"";
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="${bg}"/>${back}
    <path d="M7 48Q8 37 24 36.5Q40 37 41 48Z" fill="${shirt}"/><rect x="21" y="31" width="6" height="6" fill="${s}"/>
    <circle cx="14" cy="23.5" r="2.5" fill="${s}"/><circle cx="34" cy="23.5" r="2.5" fill="${s}"/>
    <ellipse cx="24" cy="22.5" rx="10" ry="11.5" fill="${s}"/>${cheeks}${freck}${eyes}${brows}${gl}${beard}${must}${mouth}${front}${band}${ear}</svg>`;
}

// ---------- zvířátka ----------
const ANIMALS=["kočka","pes","medvěd","panda","liška","zajíc","prasátko","žabák","opička","lev","tygr","koala","tučňák","sova","kuře","myška","kravička","jednorožec","lenochod","mýval"];
const AV_COUNT=FACES.length+ANIMALS.length;
function animal(k){
  const bg=BG[(k+2)%BG.length], E=(x,y,r,f)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${f}"/>`;
  const eyes=(c="#2B2B2B",r=1.6)=>E(19,24,r,c)+E(29,24,r,c)+E(19.6,23.4,.5,"#fff")+E(29.6,23.4,.5,"#fff");
  const head=(c,r=14)=>`<circle cx="24" cy="26" r="${r}" fill="${c}"/>`;
  const smile=(c="#4A2E2E")=>`<path d="M21 31Q24 33.5 27 31" fill="none" stroke="${c}" stroke-width="1.3" stroke-linecap="round"/>`;
  const whisk=`<path d="M12 28L18 29M12 31L18 30.5M36 28L30 29M36 31L30 30.5" stroke="#5A4A42" stroke-width=".7"/>`;
  let a="";
  switch(ANIMALS[k]){
    case "kočka": a=`<path d="M12 18L14 6L21 13Z M36 18L34 6L27 13Z" fill="#F2A65A"/><path d="M14 15L15 9L19 13Z M34 15L33 9L29 13Z" fill="#F7C6C6"/>${head("#F2A65A")}${E(19,24,1.6,"#2B2B2B")}<path d="M27 24Q29 22.4 31 24" fill="none" stroke="#2B2B2B" stroke-width="1.3" stroke-linecap="round"/><path d="M22.8 27.6H25.2L24 29Z" fill="#E86B7A"/><path d="M21 30Q22.5 31.5 24 30Q25.5 31.5 27 30" fill="none" stroke="#4A2E2E" stroke-width="1.1"/>${whisk}`;break;
    case "pes": a=`${head("#C8915C")}<ellipse cx="11.5" cy="26" rx="4.5" ry="9" fill="#8B5E3C" transform="rotate(15 11.5 26)"/><ellipse cx="36.5" cy="26" rx="4.5" ry="9" fill="#8B5E3C" transform="rotate(-15 36.5 26)"/><ellipse cx="24" cy="30" rx="7" ry="5.5" fill="#EBD3B5"/>${eyes()}<ellipse cx="24" cy="27.6" rx="2.4" ry="1.7" fill="#2B2B2B"/><path d="M21 31Q24 33 27 31" fill="none" stroke="#4A2E2E" stroke-width="1.1"/><path d="M23 32Q24 36.5 25.6 32Z" fill="#E86B7A"/>`;break;
    case "medvěd": a=`${E(13,15,5,"#8B5E3C")}${E(35,15,5,"#8B5E3C")}${E(13,15,2.6,"#C8915C")}${E(35,15,2.6,"#C8915C")}${head("#8B5E3C")}<ellipse cx="24" cy="30" rx="6" ry="4.6" fill="#C8915C"/>${eyes()}<ellipse cx="24" cy="28" rx="2" ry="1.4" fill="#2B2B2B"/>${smile()}`;break;
    case "panda": a=`${E(13,15,5,"#2B2B2B")}${E(35,15,5,"#2B2B2B")}${head("#FFFFFF")}<ellipse cx="18.8" cy="24.5" rx="3.4" ry="4.2" fill="#2B2B2B" transform="rotate(-20 18.8 24.5)"/><ellipse cx="29.2" cy="24.5" rx="3.4" ry="4.2" fill="#2B2B2B" transform="rotate(20 29.2 24.5)"/>${E(19,24,1.2,"#fff")}${E(29,24,1.2,"#fff")}<ellipse cx="24" cy="29" rx="1.8" ry="1.3" fill="#2B2B2B"/>${smile()}`;break;
    case "liška": a=`<path d="M11 20L12 5L22 13Z M37 20L36 5L26 13Z" fill="#E8772E"/>${head("#E8772E")}<path d="M10.5 27Q16 36 24 37Q32 36 37.5 27Q31 31 24 29Q17 31 10.5 27Z" fill="#FFF4E6"/>${eyes()}<ellipse cx="24" cy="29.5" rx="1.8" ry="1.3" fill="#2B2B2B"/>`;break;
    case "zajíc": a=`<ellipse cx="18" cy="9" rx="3.6" ry="10" fill="#E6E2DE"/><ellipse cx="30" cy="9" rx="3.6" ry="10" fill="#E6E2DE"/><ellipse cx="18" cy="9" rx="1.8" ry="7" fill="#F7C6C6"/><ellipse cx="30" cy="9" rx="1.8" ry="7" fill="#F7C6C6"/>${head("#E6E2DE",13)}${eyes()}<path d="M22.8 27.4H25.2L24 28.8Z" fill="#E86B7A"/><rect x="22.6" y="30.4" width="2.8" height="3" rx=".6" fill="#fff" stroke="#BDB7AF" stroke-width=".5"/>${whisk}`;break;
    case "prasátko": a=`<path d="M12 17L13 8L20 14Z M36 17L35 8L28 14Z" fill="#F29CB0"/>${head("#F7B8C6")}${eyes()}<ellipse cx="24" cy="29.5" rx="5" ry="3.6" fill="#F29CB0"/>${E(22.4,29.5,.9,"#B8566E")}${E(25.6,29.5,.9,"#B8566E")}<path d="M21.5 34Q24 35.5 26.5 34" fill="none" stroke="#B8566E" stroke-width="1.1"/>`;break;
    case "žabák": a=`${E(17,15,5.5,"#5DBB63")}${E(31,15,5.5,"#5DBB63")}${head("#5DBB63",13.5)}<rect x="12" y="12" width="10" height="6" rx="2.5" fill="#1E2A2E"/><rect x="26" y="12" width="10" height="6" rx="2.5" fill="#1E2A2E"/><path d="M22 15H26" stroke="#1E2A2E" stroke-width="1.2"/><path d="M15 28Q24 37 33 28" fill="none" stroke="#2E6B33" stroke-width="1.6" stroke-linecap="round"/>${E(19,31,1.2,"#F29CB0")}${E(29,31,1.2,"#F29CB0")}`;break;
    case "opička": a=`${E(10,26,4.5,"#8B5E3C")}${E(38,26,4.5,"#8B5E3C")}${E(10,26,2.5,"#E8C39E")}${E(38,26,2.5,"#E8C39E")}${head("#8B5E3C")}<path d="M15 25Q15 18 20 19Q24 21 28 19Q33 18 33 25Q33 37 24 37Q15 37 15 25Z" fill="#E8C39E"/>${eyes()}${E(22.5,28.5,.7,"#4A2E2E")}${E(25.5,28.5,.7,"#4A2E2E")}<path d="M20 31.5Q24 35 28 31.5" fill="#7A2E2E"/>`;break;
    case "lev": a=`${[...Array(12).keys()].map(t=>{const an=t*30*Math.PI/180;return E((24+17*Math.cos(an)).toFixed(1),(26+17*Math.sin(an)).toFixed(1),5.5,"#C4622D")}).join("")}${head("#F2C14E",13)}${E(13,15,3,"#F2C14E")}${E(35,15,3,"#F2C14E")}${eyes()}<path d="M22.4 27.6H25.6L24 29.6Z" fill="#4A2E2E"/>${smile()}`;break;
    case "tygr": a=`${E(13,15,4.5,"#F08A24")}${E(35,15,4.5,"#F08A24")}${head("#F08A24")}<path d="M24 12V17M19 13L21 17M29 13L27 17M10.5 24H15M10.5 28H14.5M37.5 24H33M37.5 28H33.5" stroke="#2B2B2B" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="24" cy="30.5" rx="6.5" ry="5" fill="#FFF4E6"/>${eyes("#2B2B2B",1.5)}<path d="M22.4 28H25.6L24 30Z" fill="#E86B7A"/>${smile()}`;break;
    case "koala": a=`${E(11,19,7,"#9AA3A8")}${E(37,19,7,"#9AA3A8")}${E(11,19,4,"#E6E2DE")}${E(37,19,4,"#E6E2DE")}${head("#9AA3A8",13)}${eyes()}<ellipse cx="24" cy="28.5" rx="3" ry="4" fill="#3A3F44"/>${smile()}`;break;
    case "tučňák": a=`${head("#2B2B2B")}<path d="M24 16Q14 18 14 29Q16 38 24 38Q32 38 34 29Q34 18 24 16Z" fill="#fff"/>${eyes()}<path d="M21 27H27L24 31Z" fill="#F4A51C"/><path d="M18 39L24 36L30 39L24 42Z" fill="#D9512C"/>`;break;
    case "sova": a=`<path d="M12 18L14 8L20 14Z M36 18L34 8L28 14Z" fill="#8B5E3C"/>${head("#A97B52")}${E(18.5,24,5.5,"#fff")}${E(29.5,24,5.5,"#fff")}${E(18.5,24,2.6,"#2B2B2B")}${E(29.5,24,2.6,"#2B2B2B")}${E(19.2,23.2,.8,"#fff")}${E(30.2,23.2,.8,"#fff")}<path d="M22 29H26L24 33Z" fill="#F4A51C"/>`;break;
    case "kuře": a=`<path d="M22 12Q23 6 24 10Q25 5 26.5 11" fill="none" stroke="#E2B13C" stroke-width="2" stroke-linecap="round"/>${head("#FFD84D",13)}${eyes()}<path d="M20.5 28L24 26L27.5 28L24 31Z" fill="#F08A24"/>${E(16.5,29,1.8,"#F7A8A8")}${E(31.5,29,1.8,"#F7A8A8")}`;break;
    case "myška": a=`${E(12,15,7,"#A9A9B3")}${E(36,15,7,"#A9A9B3")}${E(12,15,4.2,"#F7C6C6")}${E(36,15,4.2,"#F7C6C6")}${head("#A9A9B3",12.5)}${eyes()}${E(24,29,1.6,"#E86B7A")}${whisk}${smile()}`;break;
    case "kravička": a=`<path d="M14 15Q10 9 13 7M34 15Q38 9 35 7" fill="none" stroke="#E2D2B2" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="9.5" cy="21" rx="4" ry="2.4" fill="#fff" stroke="#2B2B2B" stroke-width=".6"/><ellipse cx="38.5" cy="21" rx="4" ry="2.4" fill="#fff" stroke="#2B2B2B" stroke-width=".6"/>${head("#FFFFFF")}<path d="M27 13Q34 13 35 21Q30 22 27 13Z" fill="#2B2B2B"/><ellipse cx="24" cy="31" rx="7.5" ry="5" fill="#F7B8C6"/>${E(21.5,31,1,"#B8566E")}${E(26.5,31,1,"#B8566E")}${eyes()}`;break;
    case "jednorožec": a=`<path d="M24 3L21.5 14H26.5Z" fill="#F4C542"/><path d="M22.2 7.5L25.6 8.4M21.9 10.5L26.2 11.3" stroke="#D9A21E" stroke-width=".8"/><path d="M13 17L14 9L19 14Z" fill="#F7F3EE"/>${head("#F7F3EE")}<path d="M30 12Q38 14 37 26Q35 20 31 18Z" fill="#B57EDC"/><path d="M31 15Q39 20 36 31Q34 24 30 21Z" fill="#6BC5E8"/>${eyes()}<path d="M18 22.2L16.8 21M30 22.2L31.2 21" stroke="#2B2B2B" stroke-width=".8"/>${E(17,28,1.8,"#F7A8C8")}${E(31,28,1.8,"#F7A8C8")}${smile()}`;break;
    case "lenochod": a=`${head("#B89A7A")}<ellipse cx="24" cy="27" rx="10.5" ry="8.5" fill="#E8D6BE"/><ellipse cx="19" cy="25" rx="3.6" ry="2.4" fill="#5A4231" transform="rotate(-25 19 25)"/><ellipse cx="29" cy="25" rx="3.6" ry="2.4" fill="#5A4231" transform="rotate(25 29 25)"/>${E(19,24.8,1,"#fff")}${E(29,24.8,1,"#fff")}<ellipse cx="24" cy="28.4" rx="1.8" ry="1.2" fill="#3A2A20"/><path d="M20.5 31Q24 34 27.5 31" fill="none" stroke="#3A2A20" stroke-width="1.2" stroke-linecap="round"/>`;break;
    case "mýval": a=`<path d="M12 17L13 7L20 13Z M36 17L35 7L28 13Z" fill="#8E8E96"/>${head("#B5B5BD")}<path d="M11 25Q17 20 22 24Q24 26 26 24Q31 20 37 25Q31 29 26 27Q24 26 22 27Q17 29 11 25Z" fill="#2B2B2B"/>${E(18.5,24.6,1.5,"#fff")}${E(29.5,24.6,1.5,"#fff")}${E(18.5,24.6,.8,"#2B2B2B")}${E(29.5,24.6,.8,"#2B2B2B")}<path d="M17 30Q24 37 31 30Q24 32 17 30Z" fill="#F2F2F2"/><ellipse cx="24" cy="30.6" rx="1.6" ry="1.1" fill="#2B2B2B"/>`;break;
  }
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="${bg}"/>${a}</svg>`;
}
