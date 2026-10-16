const fixtures={central:{horizon:12,duration:8},wide:{horizon:12,duration:8},withdrawal:{horizon:12,duration:8},extended:{horizon:362,duration:360},sustained:{horizon:120,duration:120},interrupted:{horizon:120,duration:120},quiet:{horizon:120,duration:120},counter:{horizon:120,duration:120},duel:{horizon:120,duration:120}};
export const supportedFixtureKind=kind=>typeof kind==='string'&&Object.hasOwn(fixtures,kind);
export function fixtureSettings(kind){if(!supportedFixtureKind(kind))throw new RangeError('Choose a supported synthetic fixture.');return {...fixtures[kind]};}

export const matchCatalogue=[
 {id:'northbridge-harbour',kind:'sustained',seed:17,home:'Northbridge',away:'Harbour Athletic',description:'Quick combinations and dangerous chances in the final third.'},
 {id:'kingsport-riverside',kind:'interrupted',seed:41,home:'Kingsport United',away:'Riverside City',description:'An open passage with turnovers, blocked shots and both teams attacking.'},
 {id:'eastvale-westhaven',kind:'quiet',seed:73,home:'Eastvale Rovers',away:'Westhaven FC',description:'Patient passing and controlled buildup. Follow every touch.'}
];
export function fixtureTeams(kind,seed){const match=matchCatalogue.find(m=>m.kind===kind&&m.seed===seed);return match?{home:match.home,away:match.away}:{home:'Northbridge',away:'Harbour Athletic'};}

const additionalClubs=['Lakeside Town','Ironford United','Ashford Athletic','Stonehaven City','Meadow Park','Oakwell Rovers','Crestwood FC','Redwick Town','Hillcrest United','Brookfield City','Silvermere FC','Portwell Athletic','Dunford Rovers','Fairhaven Town','Glenmoor United','Seabrook City','Willow Athletic','Hawthorne FC','Highfield Town','Bracken Rovers'];
const families=['counter','duel','sustained','interrupted','quiet'];
const descriptions={counter:'Fast turnovers and chances at both ends.',duel:'Wide combinations and an end-to-end contest.',sustained:'Attacking combinations and dangerous shooting positions.',interrupted:'Recoveries, rebounds and changes of momentum.',quiet:'Patient circulation and movement between the lines.'};
for(let i=0;i<17;i++){
 const home=additionalClubs[i],away=additionalClubs[(i+7)%additionalClubs.length],kind=families[i%families.length];
 matchCatalogue.push({id:`fixture-${i+4}`,kind,seed:1000+i,home,away,description:descriptions[kind]});
}
