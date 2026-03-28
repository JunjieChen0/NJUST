// 测试 agent_code 与 NJUST 扩展的集成
const { exec } = require('child_process');
const path = require('path');

const agentCodePath = path.join(__dirname, '..', 'Desktop', 'agent_code', 'agent_code');

console.log('测试 agent_code 与 NJUST 扩展集成');
console.log('Agent Code 路径:', agentCodePath);

// 检查 agent_code 是否存在
const fs = require('fs');
if (!fs.existsSync(agentCodePath)) {
    console.error('错误: agent_code 目录不存在');
    process.exit(1);
}

// 运行简单的测试命令
const testCommand = `cd "${agentCodePath}" && node dist/cli/index.js "测试NJUST集成"`;

console.log('执行命令:', testCommand);

exec(testCommand, (error, stdout, stderr) => {
    if (error) {
        console.error('执行错误:', error.message);
        console.error('stderr:', stderr);
        return;
    }
    console.log('stdout:', stdout);
});