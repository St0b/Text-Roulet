export const GALAXY_CAMPAIGN_KEY = 'greenos-galaxy-campaign-v1';
export const MAX_UPGRADE = 4;
const MAX_SCRAP = 999999;

export const UPGRADES = {
  weapon:{name:'Оружие', description:'Ускоряет стрельбу. На II уровне — двойной залп, на III — пробитие брони, на IV — тройной залп.', base:12},
  armor:{name:'Броня', description:'Добавляет единицу корпуса за уровень.', base:10},
  engine:{name:'Двигатель', description:'Увеличивает скорость корабля на 12% за уровень.', base:8},
  magnet:{name:'Сборщик', description:'Притягивает обломки и бонусы с большего расстояния.', base:8},
};

export const SECTORS = [
  {
    name:'Сигнал маяка', location:'Внешняя орбита', reward:14,
    story:'Маяк колонии передал сигнал бедствия. Диспетчер Ника просит расчистить подходы, пока станция ещё держит связь.',
    report:'В обломках перехватчиков нашли карту. Сигнал глушит сеть ретрансляторов, а не шторм.',
    waves:[{ships:5, formation:'line'}, {ships:7, formation:'cross', tier:1}],
  },
  {
    name:'Кладбище кораблей', location:'Пояс Вега', reward:20,
    story:'За поясом дрейфуют грузы колонии. Эскадра мародёров патрулирует обломки и уводит уцелевшие суда.',
    report:'Спасённый пилот называет координаты передатчика и предупреждает об охраняющем его флагмане.',
    waves:[{ships:7, formation:'cross'}, {ships:9, formation:'wings', tier:1}],
  },
  {
    name:'Немой ретранслятор', location:'Тень Кеплера', reward:28,
    story:'Передатчик командует вражеским роем. Пройдите эскорт и выведите из строя его флагман.',
    report:'Диспетчер выходит на связь. За помехами стоит автономная верфь, которая приняла гражданские корабли за угрозу.',
    waves:[{ships:7, formation:'wings', tier:1}, {ships:8, formation:'line', tier:1}, {boss:true, hp:25}],
  },
  {
    name:'Верфь «Кассини»', location:'Промышленное кольцо', reward:36,
    story:'Пока ремонтные дроны выводят из строя сборочные линии, прикройте их от волн перехватчиков.',
    report:'Производство остановлено. Последняя эскадра уже ушла к станции и готовит осаду.',
    waves:[{ships:9, formation:'line', tier:1}, {ships:10, formation:'cross', tier:2}, {ships:12, formation:'wings', tier:2}],
  },
  {
    name:'Блокада станции', location:'Орбита колонии', reward:48,
    story:'Эвакуационные шаттлы ждут на взлётной полосе. Перехватите передовую группу и корабль, управляющий блокадой.',
    report:'Шаттлы вышли из зоны огня. По данным их экипажа, последняя команда рою приходит из сектора Ω.',
    waves:[{ships:9, formation:'wings', tier:2}, {ships:12, formation:'cross', tier:2}, {boss:true, hp:40}],
  },
  {
    name:'Ядро Ω', location:'Запретная орбита', reward:70,
    story:'Ядро прячется за последним строем охранения. Уничтожьте его флагман, чтобы обесточить сеть наведения.',
    report:'Сеть отключена. Колония снова на связи. Ника переводит вас в резерв, а карта секторов остаётся открытой для повторных вылетов.',
    waves:[{ships:10, formation:'cross', tier:2}, {ships:11, formation:'wings', tier:2},
      {ships:12, formation:'line', tier:2}, {boss:true, hp:56}],
  },
];

const integer = (value, maximum) => Number.isInteger(value) && value >= 0 && value <= maximum;

export function isCampaignProgress(value) {
  return value?.version === 1 && integer(value.scrap, MAX_SCRAP) && integer(value.cleared, SECTORS.length)
    && Object.keys(UPGRADES).every(id => integer(value.upgrades?.[id], MAX_UPGRADE));
}

export function readCampaign() {
  try {
    const value = JSON.parse(localStorage.getItem(GALAXY_CAMPAIGN_KEY));
    if (isCampaignProgress(value)) return value;
  } catch { /* A fresh campaign is still available. */ }
  return {version:1, scrap:0, cleared:0, upgrades:{weapon:0, armor:0, engine:0, magnet:0}};
}

export function changeCampaign(change, fallback) {
  const update = () => {
    let value;
    try {
      const stored = JSON.parse(localStorage.getItem(GALAXY_CAMPAIGN_KEY));
      if (isCampaignProgress(stored)) value = stored;
    } catch { /* Keep the running session's progress. */ }
    const previous = value ?? fallback;
    const next = change(previous);
    try {
      localStorage.setItem(GALAXY_CAMPAIGN_KEY, JSON.stringify(next));
      return {value:next,writable:true};
    } catch { return {value:previous,writable:false}; }
  };
  return navigator.locks?.request ? navigator.locks.request(GALAXY_CAMPAIGN_KEY, update) : Promise.resolve(update());
}

export function rewardCampaign(value, sector, success, collected) {
  const firstClear = success && sector === value.cleared;
  const reward = collected + (firstClear ? SECTORS[sector].reward : 0);
  return {...value, scrap:Math.min(MAX_SCRAP, value.scrap + reward), cleared:value.cleared + Number(firstClear)};
}

export const upgradeCost = (id, level) => UPGRADES[id].base * (level + 1) ** 2;

export function buyUpgrade(value, id) {
  const level = value.upgrades[id], cost = upgradeCost(id, level);
  if (level >= MAX_UPGRADE || value.scrap < cost) return value;
  return {...value, scrap:value.scrap - cost, upgrades:{...value.upgrades, [id]:level + 1}};
}
