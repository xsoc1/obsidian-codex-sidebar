import { readFileSync } from "node:fs";
import { RemoteBridge, init_config, type BridgeConfig } from "./bridge";

async function main(): Promise<void>
{
	const Args = process.argv.slice(2);
	const Value = (Name: string) => Args[Args.indexOf(Name) + 1];
	const File = Args.includes("--config") ? Value("--config") : "";
	if(!File)
	{
		throw new Error("使用 --config <本机私有配置路径>. --init 另需 --cwd --cli --vault --obsidian-cli");
	}
	if(Args.includes("--init"))
	{
		if(["--cwd", "--cli", "--vault", "--obsidian-cli"].some(Name => !Args.includes(Name)))
		{
			throw new Error("初始化参数不完整");
		}
		init_config(File, Value("--cwd"), Value("--cli"), Value("--vault"), Value("--obsidian-cli"));
		process.stdout.write("已生成私有配置与 connection-private.json. 配对密钥不打印到日志.\n");
		return;
	}
	const Bridge = new RemoteBridge(JSON.parse(readFileSync(File, "utf8")) as BridgeConfig);
	const Port = await Bridge.listen();
	process.stdout.write(`Independent iPad bridge listening on loopback:${Port}\n`);
	for(const Event of ["SIGINT", "SIGTERM"] as const)
	{
		process.once(Event, () => void Bridge.close().then(() => process.exit(0)));
	}
}

void main().catch(ErrorValue =>
{
	process.stderr.write(String(ErrorValue.message) + "\n"); process.exitCode = 1;
});
