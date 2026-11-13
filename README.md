# 数电发票收集与打印系统

用于高校报销场景的电子发票管理系统，提供发票识别、人工核对、预算统计、逐张扫描标记和原件拼版打印。支持桌面和移动端浏览器。

## 功能

- 学生使用管理员登记的姓名与学号登录，上传 XML、PDF、JPG 或 PNG 发票，核对并提交发票信息。
- 管理员管理学生和管理员账号、查看和修改发票、批量删除、锁定及管理打印状态。
- 根据金额规则要求填写资金用途或限制上传，管理员可自定义阈值。
- 管理员逐张翻阅发票原件，标记或撤销扫描状态。
- 管理员设置预算上限，学生和管理员可查看累计支出、剩余预算及各用户支出饼图。统计范围为已提交发票的价税合计，删除发票会更新统计。
- 管理员拖动调整打印顺序，预览后生成 A4 拼版 PDF，保留打印批次记录。
- 支持导出发票主表、明细和字段来源 Excel。

## 技术栈

前端使用 Vue 3、Vite、Element Plus、Pinia 和 ECharts。后端使用 Node.js、Express 和 SQLite。PDF 处理使用 PDF.js 和 pdf-lib，图片识别使用 RapidOCR 和 ONNX Runtime。

## 安装与运行

需要 Node.js 22.5 或以上。图片识别还需要 Python 3.12 和 Git。以下命令在项目根目录执行，Windows PowerShell 可使用 `npm.cmd`。

```powershell
npm.cmd install
npm.cmd run setup
npm.cmd run setup:ocr
npm.cmd run init-db
npm.cmd run dev
```

打开 http://localhost:5173。后端监听 3001，健康检查地址为 http://localhost:3001/api/health。`setup:ocr` 会安装识别依赖并下载模型，完成后识别在本机运行。若暂不安装，可设置环境变量 `INVOICE_OCR=0`，系统仍支持文本和手工录入。

数据库首次初始化后，管理员入口为 http://localhost:5173/admin/login，初始账号为 `admin`，初始密码见 `server/config.js`。请登录后在「用户管理」修改密码。学生账号需要管理员先行登记。可执行 `npm.cmd run seed` 添加示例学生和发票，已有发票时此命令会跳过。

## 使用流程

1. 管理员登录，在「用户管理」添加学生，设置金额规则和预算上限。
2. 学生上传发票、核对识别结果并提交。金额超过用途阈值时填写资金用途。
3. 管理员在「全部发票」查询和处理发票，在「发票扫描」逐张查看原件并标记扫描状态。
4. 在「拼版打印」选择发票、拖动排序并预览，然后生成打印 PDF。仅有 XML 或手工信息的发票需要 PDF 或图片原件才能拼版。
5. 学生和管理员在「预算使用」查看使用情况。

## 生产构建

```powershell
npm.cmd run build
npm.cmd start
```

访问 http://localhost:3001。部署时设置独立的 `JWT_SECRET` 环境变量，修改初始管理员密码。`DATA_DIR` 和 `UPLOADS_DIR` 可分别指定数据库及原件存储目录。数据库结构会在启动时初始化并升级。

## 测试

```powershell
npm.cmd test
```

## 项目结构

```text
server/                 Express API、SQLite、识别及打印逻辑
server/src/db/          数据表和数据库初始化
server/src/parse/       发票解析与本地图片识别
server/src/routes/      登录、发票、用户、预算及打印接口
server/src/services/    发票业务、打印及导出
server/tests/           后端测试
web/                    Vue 前端
```

运行数据位于 `server/data/` 和 `server/uploads/`。请定期同时备份数据库和上传文件。项目目录中的本地样票、数据库、上传文件、依赖和构建产物不纳入版本控制。

