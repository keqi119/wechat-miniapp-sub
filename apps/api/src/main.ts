import { createApp } from './app';
createApp().then(app => app.listen(Number(process.env.PORT || 3101), process.env.HOST || '127.0.0.1')).catch(() => { console.error('API启动失败，请检查独立数据库和服务配置。'); process.exitCode = 1; });
