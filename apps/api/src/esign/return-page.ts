export const esignReturnPage=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>返回小程序</title></head>
<body style="font-family:sans-serif;padding:32px;line-height:1.7"><h2>正在返回小程序</h2><p>返回后，请点击「主动核验双方签署与归档」查看真实结果。页面返回本身不代表签署或归档完成。</p><button id="return-button" style="padding:14px 24px;font-size:16px">返回小程序</button><p>如未自动返回，请点击上方按钮，或使用左上角返回。</p>
<script>
var returnedToMiniapp=false;
function returnToMiniapp(manual){
 if(window.wx&&wx.miniProgram&&wx.miniProgram.getEnv){
  wx.miniProgram.getEnv(function(env){if(env.miniprogram&&(!returnedToMiniapp||manual===true)){returnedToMiniapp=true;wx.miniProgram.navigateBack({delta:1});}});
 }
}
document.getElementById('return-button').onclick=function(){returnToMiniapp(true);};
document.addEventListener('WeixinJSBridgeReady',returnToMiniapp);
</script><script src="https://res.wx.qq.com/open/js/jweixin-1.6.0.js" onload="returnToMiniapp()" referrerpolicy="no-referrer"></script></body></html>`;
