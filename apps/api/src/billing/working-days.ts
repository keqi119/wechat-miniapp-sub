const data={
  "version": "CN-OFFICIAL-20261108-v1",
  "years": [
    {
      "year": 2026,
      "notice": "国办发明电〔2025〕7号",
      "publishedAt": "2025-11-04",
      "sourceUrl": "https://www.beijing.gov.cn/gate/big5/www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html",
      "canonicalUrl": "https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm",
      "holidayRanges": [
        [
          "2026-01-01",
          "2026-01-03"
        ],
        [
          "2026-02-15",
          "2026-02-23"
        ],
        [
          "2026-04-04",
          "2026-04-06"
        ],
        [
          "2026-05-01",
          "2026-05-05"
        ],
        [
          "2026-06-19",
          "2026-06-21"
        ],
        [
          "2026-09-25",
          "2026-09-27"
        ],
        [
          "2026-10-01",
          "2026-10-07"
        ]
      ],
      "workingWeekends": [
        "2026-01-04",
        "2026-02-14",
        "2026-02-28",
        "2026-05-09",
        "2026-09-20",
        "2026-10-10"
      ]
    },
    {
      "year": 2027,
      "notice": "国办发明电〔2026〕10号",
      "publishedAt": "2026-11-05",
      "sourceUrl": "https://www.forestry.gov.cn/lyj/1/szxx/20261105/695102.html",
      "canonicalUrl": "https://www.gov.cn/zhengce/content/202611/content_7085101.htm",
      "holidayRanges": [
        [
          "2027-01-01",
          "2027-01-03"
        ],
        [
          "2027-02-05",
          "2027-02-13"
        ],
        [
          "2027-04-03",
          "2027-04-05"
        ],
        [
          "2027-05-01",
          "2027-05-05"
        ],
        [
          "2027-06-09",
          "2027-06-09"
        ],
        [
          "2027-09-15",
          "2027-09-15"
        ],
        [
          "2027-10-01",
          "2027-10-07"
        ]
      ],
      "workingWeekends": [
        "2027-01-31",
        "2027-02-14",
        "2027-05-08",
        "2027-09-26",
        "2027-10-09"
      ]
    }
  ]
};
import {canonicalHash} from '../customers/types';
export const calendarCoverage=()=>({version:data.version,hash:canonicalHash(data),years:data.years.map(y=>({year:y.year,notice:y.notice,sourceUrl:y.sourceUrl,canonicalUrl:y.canonicalUrl,publishedAt:y.publishedAt,hash:canonicalHash(y)})),maintenance:{responsibleRole:'ADMIN',instruction:'按国务院办公厅正式年度通知新增不可变日历版本，核对调休及节假日并部署后重算缺失期限；不得编辑触发时间或已有期限。'}});
export function dueWorkingDay(trigger:Date,count:number){
 if(!Number.isFinite(trigger.getTime())||!Number.isInteger(count)||count<1||count>31)throw new RangeError('WORKING_DAY_INPUT');
 let cursor=Date.parse(new Date(trigger.getTime()+8*3600000).toISOString().slice(0,10)+'T00:00:00Z'),remaining=count;const versions:any[]=[];
 while(remaining){cursor+=86400000;const date=new Date(cursor),day=date.toISOString().slice(0,10),year=date.getUTCFullYear(),cal=data.years.find(y=>y.year===year);
 if(!cal)return{status:'CALENDAR_REQUIRED',dueAt:null,missingYear:year,calendarVersion:data.version,calendarHash:canonicalHash(data),versions};
 if(!versions.some(v=>v.year===year))versions.push({year,notice:cal.notice,sourceUrl:cal.sourceUrl,hash:canonicalHash(cal)});
 const holiday=cal.holidayRanges.some(([a,b])=>a<=day&&day<=b),work=cal.workingWeekends.includes(day)||!holiday&&date.getUTCDay()>0&&date.getUTCDay()<6;if(work)remaining--;
 }
 return{status:'CALCULATED',dueAt:new Date(cursor+16*3600000-1000).toISOString(),missingYear:null,calendarVersion:data.version,calendarHash:canonicalHash(data),versions};
}
