# 完整组件草稿协议

resourceDraft 默认 null。仅对普通完整项目 pass 或精选 qualify/not_qualify 使用。对象包含 title（2～80字）、summary（10～400字）、description（20～4000字）、category（嵌入式系统/FPGA/创意软件之一，沿用服务端主类值）、tags（最多10个）、hardware（环境与依赖）、instructions（接口、单位、最小接入方法）、limitations（真实验证范围与局限）、sourcePath（实际读取的来源文件全路径）、quote（该文件的连续原文，最多500字）、files（1～8个{name,content}完整文本文件）。

文件名不含目录，仅用字母、数字、中文、空格、下划线、点和短横线；支持 js/mjs/ts/c/h/cpp/py/v/sv/md/txt/json/html/css。单文件最多20000字符、整份草稿最多40KB；保留 RESOURCE-INFO.txt 给系统生成。不要输出伪代码、待填 TODO、缺失的 import 或不可独立使用的片段。sourcePath 必须逐字使用工具实际读取的路径，quote 必须来自该文件正文，不能引用推荐语。许可由服务端沿用来源项目，作者可修改；不自行补 MIT 等授权。草稿先经作者确认，再独立审核，不代表已发布。
