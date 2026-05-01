import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startStaticServer } from "./helpers/static-server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..");

let staticServer;

before(async () => {
  staticServer = await startStaticServer(projectRoot);
});

after(async () => {
  await staticServer.close();
});

async function fetchText(pathname) {
  const response = await fetch(`${staticServer.url}${pathname}`);
  const body = await response.text();
  return { body, response };
}

test("login page renders the auth shell", async () => {
  const { response, body } = await fetchText("/login.html");

  assert.equal(response.status, 200);
  assert.match(body, /<title>Вход — Tehnadzor<\/title>/);
  assert.match(body, /id="loginEmail"/);
  assert.match(body, /id="loginPassword"/);
  assert.match(body, /id="btnLogin"/);
  assert.match(body, /src="dist\/auth\.js"/);
});

test("register page exposes registration controls", async () => {
  const { response, body } = await fetchText("/register.html");

  assert.equal(response.status, 200);
  assert.match(body, /<title>Регистрация — Tehnadzor<\/title>/);
  assert.match(body, /id="registerEmail"/);
  assert.match(body, /id="registerPassword"/);
  assert.match(body, /id="btnRegister"/);
});

test("about page returns the public product narrative", async () => {
  const { response, body } = await fetchText("/about.html");

  assert.equal(response.status, 200);
  assert.match(body, /О проекте — Tehnadzor/);
  assert.match(body, /Сервис для строительного контроля/);
  assert.match(body, /BIM \/ IFC/);
});

test("profile page keeps its primary shell accessible", async () => {
  const { response, body } = await fetchText("/profile.html");

  assert.equal(response.status, 200);
  assert.match(body, /Профиль — Tehnadzor/);
  assert.match(body, /id="btnLogout"/);
  assert.match(body, /id="themeToggleBtn"/);
});
