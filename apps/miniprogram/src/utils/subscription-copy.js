// Original copy inspired by journeys, curiosity and everyday freedom.
// Keep each headline and its supporting copy together on both discovery pages.
const subscriptionCopies = [
  {
    id: 'just-right',
    title: '选一台，刚刚好。',
    lines: ['找到适合日常的纯电车。', '月费、里程与使用条件，清楚选择。'],
    catalogDescription: '找到适合自己的车辆与订阅方案。',
  },
  {
    id: 'beyond-daydreams',
    title: '别只向往，去往。',
    lines: ['把看过的风景，变成经过的地方。', '从一次出发，靠近想过的生活。'],
    catalogDescription: '选一台合心意的车，让向往有个方向。',
  },
  {
    id: 'find-yourself',
    title: '路上，遇见自己。',
    lines: ['有些答案，要走出去才知道。', '下一程，按自己的心意出发。'],
    catalogDescription: '从喜欢的车型出发，走一段自己的路。',
  },
  {
    id: 'leave-some-space',
    title: '偶尔，也去放空。',
    lines: ['把日程留白，让风景填满。', '这一程，听风，也听听自己。'],
    catalogDescription: '选一台合适的车，为日程留一点空白。',
  },
  {
    id: 'find-your-joy',
    title: '快乐，值得绕路。',
    lines: ['沿途的湖光，路边的小店。', '那些让你笑的瞬间，也值得出发。'],
    catalogDescription: '为喜欢的风景，挑一台合适的纯电车。',
  },
  {
    id: 'stay-curious',
    title: '愿你，依然有光。',
    lines: ['看过更多风景，仍对明天好奇。', '把那份喜欢，带上下一段路。'],
    catalogDescription: '选一台喜欢的车，把好奇心也带上。',
  },
  {
    id: 'live-the-story',
    title: '把今天，过成故事。',
    lines: ['想去的地方，别总留给以后。', '把一次期待，写成今天的经历。'],
    catalogDescription: '为下一段故事，选一台合心意的车。',
  },
  {
    id: 'share-the-view',
    title: '风景，要一起看。',
    lines: ['带上想见的人，去看想看的风景。', '有些快乐，因为同行而更完整。'],
    catalogDescription: '为想同行的人，选一台合适的车。',
  },
  {
    id: 'your-next-stop',
    title: '下一站，听你的。',
    lines: ['去海边，或去山野。', '沿着自己的心意，安排下一程。'],
    catalogDescription: '找到适合行程的车，下一站由你来选。',
  },
  {
    id: 'room-for-distance',
    title: '留一点，给远方。',
    lines: ['生活有按部就班，也有心之所向。', '为想去的地方，留一段自己的时间。'],
    catalogDescription: '让喜欢的车，陪你安排日常与远方。',
  },
  {
    id: 'everyday-wilderness',
    title: '日常，也有旷野。',
    lines: ['一条没走过的路，一场忽然的日落。', '熟悉的生活里，也有新的风景。'],
    catalogDescription: '为日常添一点新意，从选一台车开始。',
  },
  {
    id: 'follow-the-spark',
    title: '趁心动，去走走。',
    lines: ['把想去的地方，慢慢走成回忆。', '留一段行程，给一直惦记的风景。'],
    catalogDescription: '为一直惦记的风景，挑一台合适的车。',
  },
];

function nextSubscriptionCopy(currentId, items = subscriptionCopies) {
  const candidates = items.filter(copy => copy.id !== currentId);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

module.exports = { subscriptionCopies, nextSubscriptionCopy };
