// @ts-nocheck
import { chromium } from 'playwright';
import { serializeState } from '../engine/index';
import { BASE, TODAY, STATES, put } from './ui-states';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/?today=${TODAY}`);
await put(page, serializeState(STATES['pos-l4'](), TODAY));
await page.goto(`${BASE}/?today=${TODAY}#/position`); await page.reload(); await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/shot-pos.png', fullPage: false });
await b.close();
