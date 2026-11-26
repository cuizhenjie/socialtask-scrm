---
name: socialtask-acceptance
description: 核对工单模板、企微模拟和企微真机的不同验收证据，明确通过、失败、待验证。
---
# 3COOL · SocialTask 验收
1. 选 template、wecom-synthetic 或 wecom-device，混合需求分开列。先调用 socialtask_assess_evidence，evidenceJson 传 "{}" 取得清单。
2. 每个断言只用可定位的脱敏引用（例：隔离测试输出编号、合成工单编号、手机录屏编号）；缺证据填 pending，不能造测试结果。结果结构是检查项 ID → {result:"pass"|"fail"|"pending", reference:"脱敏证据指向"}。
3. 模拟验收检查验签/去重、来源关联、模拟卡片和安全回跳。真机检查授权成员发消息入箱、联动建单、指定成员手机收到卡片及点击后打开同一工单。CI 通过、Outbox SENT、模拟网关接收都不能当真机送达。
4. 只输出结论、可追溯证据与最小补验步骤；工具不验证输入引用实际存在，不执行生产测试，不推送或操作真实后端。
