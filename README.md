# 油站网点地图管理

- 行业：石油
- 技术栈：Vue3、Vite、TypeScript、Element Plus、Leaflet
- 启动：`npm install && npm run dev`
- 构建：`npm run build`

这是一个功能最小闭环前端项目，数据默认保存在浏览器localStorage中，方便后续扩展接口、权限、图表或地图能力。

## 证照到期管理

每个油站维护经营许可、危化品许可、消防许可三类证照的到期日，不接后台、无新增依赖：

- `src/license/licenseRules.ts` 证照规则（纯函数）：到期判定、到期前 30 天提醒、站点证照状态聚合（待补录 / 证照异常 / 30天内到期 / 证照正常）、流转拦截判定。任一证照过期即「证照异常」，原营业状态保留且不能流转；续办后三类都有效自动回到原状态。
- `src/license/licenseMigration.ts` 数据迁移：历史记录首次加载时补齐空证照并显示「待补录」，迁移幂等，沿用原 localStorage key。
- `src/license/licenseCard.ts` 页面交互：卡片补录/续办编辑态、续办提醒汇总、流转按钮拦截入口。
