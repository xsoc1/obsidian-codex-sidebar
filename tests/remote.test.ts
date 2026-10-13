import { test } from "node:test";
import assert from "node:assert/strict";
import { RemoteConnection, remote_url } from "../src/remote";

test("remote endpoints require private HTTPS or explicit loopback testing; credentials never enter URL", () =>
{
	assert.equal(remote_url("https://example.test:8445/"), "https://example.test:8445");
	assert.equal(remote_url("http://127.0.0.1:17895"), "http://127.0.0.1:17895");
	for(const Url of ["http://192.168.1.3", "https://user:secret@example.test", "https://example.test?token=secret", "file:///vault", "https://example.test#token"])
	{
		assert.throws(() => remote_url(Url));
	}
});

test("remote polling replays each event once and state sync uses the captured cursor", async () =>
{
	const Requests: any[] = []; const Messages: any[] = [];
	const Config = { Enabled: true, Url: "https://example.test", Token: "test", Server: "old", Cursor: 8 };
	const Connection = new RemoteConnection(async (Url, Method, Body) =>
	{
		Requests.push({ Url, Method, Body });
		if(Url === "/info")
		{
			return { server: "new" };
		}
		if(Url.startsWith("/events"))
		{
			return { events: [{ seq: 1, message: { method: "test" } }], cursor: 1 };
		}
		return {};
	}, Config, Message => Messages.push(Message), ErrorValue =>
	{
		throw ErrorValue;
	}, () =>
	{
	});
	await Connection.connect(); assert.equal(Config.Cursor, 0);
	Connection.start(); await new Promise(Resolve => setTimeout(Resolve, 20));
	assert.equal(Messages.length, 1); assert.equal(Config.Cursor, 1);
	await Connection.sync_state({ test: true }, 0);
	assert.equal(Requests.at(-1).Body.cursor, 0);
	Connection.close(); assert.equal(Config.Cursor, 1);
});

test("state writes stay ordered per connection and closed queues cannot post old snapshots", async () =>
{
	let Release: () => void = () => {};
	let Reached: () => void = () => {};
	const Pending = new Promise<void>(Resolve => { Release = Resolve; });
	const Started = new Promise<void>(Resolve => { Reached = Resolve; });
	const Posted: unknown[] = [];
	const Config = { Enabled: true, Url: "https://example.test", Token: "fixture", Server: "", Cursor: 0 };
	const Connection = new RemoteConnection(async (_Url, _Method, Body) =>
	{
		Posted.push(Body); Reached(); await Pending; return { cursor: 0 };
	}, Config, () => {}, () => {}, () => {});
	const First = Connection.sync_state({ revision: 1 });
	await Started;
	const Second = Connection.sync_state({ revision: 2 });
	const Rejected = assert.rejects(Second, /远程连接已关闭/);
	Connection.close();
	let FreshSaved = false;
	const Fresh = new RemoteConnection(async () => { FreshSaved = true; return {}; }, { ...Config }, () => {}, () => {}, () => {});
	await Fresh.sync_state({ revision: 3 });
	assert.equal(FreshSaved, true);
	assert.equal(Posted.length, 1);
	Release(); await First; await Rejected; Fresh.close();
	assert.equal(Posted.length, 1);
});
