export function paragraphs(value:string):string[]{return value.replace(/\r\n?/g,'\n').split(/\n[\t ]*\n+/).filter(part=>part.trim().length>0);}
