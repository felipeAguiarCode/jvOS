import { expect, test, type Page } from "@playwright/test";
import { PLAIN_SETTINGS, SCREENS, standInMusic, waitForFrames } from "./helpers";

const player = (page: Page) => page.getByRole("dialog", { name: "jv_T4p3" });
const nowPlaying = (page: Page) => player(page).getByRole("status").filter({ hasText: /Tocando agora|Sintonizando|Pausado|Erro/ });
const cassette = (page: Page) => page.getByTestId("cassette");
const saved = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key);
const voiceMusic = (page: Page, action: string, target: string | null = null) =>
  page.evaluate(([a, t]) => window.__JARVIS__!.voiceMusic({ action: a as "play", target: t }), [action, target] as const);
const voiceWindow = (page: Page, kind: string, open: boolean) => page.evaluate(([k, o]) => window.__JARVIS__!.voiceWindow({ kind: k, open: o }), [kind, open] as const);

async function openPlayer(page: Page) {
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await page.getByRole("dialog", { name: "Menu de apps" }).getByRole("button", { name: "jv_T4p3" }).click();
  await expect(page.getByTestId("tape-player")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("tape-player")).toBeFocused();
  return player(page);
}

/** Two looks at the cassette half a second apart. */
async function cassetteMoves(page: Page, locator = cassette(page)) {
  const before = await locator.textContent();
  await page.waitForTimeout(500);
  return before !== (await locator.textContent());
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    ["jarvis.desktop", "jarvis.music", "jarvis.music.playlists"].forEach((key) => localStorage.removeItem(key));
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page);
  await page.waitForTimeout(800);
});

test("jv_T4p3 lists the Vice City stations and plays one, with the cassette turning", async ({ page }) => {
  const window = await openPlayer(page);
  const stations = window.getByRole("listbox", { name: "Playlists" });
  for (const name of ["Wildstyle", "Flash FM", "Fever 105", "V-Rock", "Radio Espantoso", "Emotion 98.3", "Wave 103"]) {
    await expect(stations.getByRole("option", { name, exact: false })).toBeVisible();
  }
  await expect(stations.getByRole("option", { name: "Flash FM" })).toHaveAttribute("aria-selected", "true");
  await expect(window.getByRole("listbox", { name: "Músicas de Flash FM" }).getByRole("option")).toHaveCount(16);

  // Without yt-dlp (a browser), playing says where it works.
  await page.keyboard.press("Enter");
  await expect(nowPlaying(page)).toContainText("Disponível no app desktop");

  // ←→ change station, ↑↓ the song; the yt-dlp stand-in plays a silent WAV.
  await standInMusic(page, 12);
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  const songs = window.getByRole("listbox", { name: "Músicas de Wave 103" });
  await expect(songs.getByRole("option")).toHaveCount(16);
  await expect(songs.getByRole("option", { name: /Atomic — Blondie/ })).toBeVisible();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(nowPlaying(page)).toHaveText("Tocando agora: Atomic — Blondie");
  await expect(songs.getByRole("option", { name: /Atomic/ })).toHaveAttribute("aria-current", "true");
  await expect(cassette(page)).toContainText("WAVE 103");
  await expect(cassette(page)).toContainText("Atomic — Blondie");
  expect(await cassetteMoves(page)).toBe(true);
  await expect.poll(async () => (await page.getByTestId("music-time").textContent()) ?? "").toMatch(/^0:0[1-9] \/ 0:12$/);
  await expect.poll(async () => parseFloat((await page.getByTestId("music-progress").getAttribute("style"))?.match(/width: ([\d.]+)%/)?.[1] ?? "0")).toBeGreaterThan(5);
  await page.screenshot({ path: `${SCREENS}/music-player.png` });

  // Space pauses: the reels stop.
  await page.keyboard.press(" ");
  await expect(nowPlaying(page)).toHaveText("Pausado: Atomic — Blondie");
  expect(await cassetteMoves(page)).toBe(false);
  await page.keyboard.press(" ");
  await expect(nowPlaying(page)).toHaveText("Tocando agora: Atomic — Blondie");

  // n / b; volume and shuffle are remembered.
  await page.keyboard.press("n");
  await expect(nowPlaying(page)).toHaveText("Tocando agora: 99 Luftballons — Nena");
  await page.keyboard.press("b");
  await expect(nowPlaying(page)).toHaveText("Tocando agora: Atomic — Blondie");
  await page.keyboard.press("-");
  await page.keyboard.press("s");
  await expect(page.getByTestId("music-volume")).toHaveText("vol 75%");
  await expect.poll(() => saved(page, "jarvis.music")).toMatchObject({ stationId: "wave", volume: 0.75, shuffle: true });

  // A song that ends gives way to the next one by itself.
  await page.keyboard.press("s");
  await standInMusic(page, 1.2);
  await page.keyboard.press("n");
  await expect(nowPlaying(page)).toHaveText("Tocando agora: 99 Luftballons — Nena");
  await expect(nowPlaying(page)).toHaveText("Tocando agora: Kids in America — Kim Wilde", { timeout: 6000 });
});

test("playlists of YouTube links are created, edited, kept and played", async ({ page }) => {
  const window = await openPlayer(page);
  await standInMusic(page, 12);

  await page.keyboard.press("p");
  const name = window.getByRole("textbox", { name: "Nome da nova playlist" });
  await expect(name).toBeFocused();
  await name.fill("Treino");
  await name.press("Enter");
  const link = window.getByRole("textbox", { name: "Link do YouTube" });
  await expect(link).toBeFocused();
  await expect(window.getByRole("option", { name: "Treino" })).toHaveAttribute("aria-selected", "true");
  await expect(window.getByText("Playlist vazia")).toBeVisible();

  for (const url of ["https://www.youtube.com/watch?v=O_WLw_0DFQQ&t=5", "youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/shorts/aqz-KE-bpKQ"]) {
    await link.fill(url);
    await link.press("Enter");
    await expect(link).toHaveValue("");
  }
  await link.fill("https://example.com/watch?v=O_WLw_0DFQQ");
  await link.press("Enter");
  await expect(window.getByText("Isso não parece um link do YouTube")).toBeVisible();
  await link.fill("O_WLw_0DFQQ");
  await link.press("Enter");
  await expect(window.getByText("Esse vídeo já está na playlist")).toBeVisible();

  const songs = window.getByRole("listbox", { name: "Músicas de Treino" });
  await expect(songs.getByRole("option")).toHaveCount(3);
  await page.screenshot({ path: `${SCREENS}/music-playlist.png` });

  // Removed with ×; renamed; all of it survives a reload.
  await songs.getByRole("button", { name: "Remover youtu.be/dQw4w9WgXcQ" }).click();
  await expect(songs.getByRole("option")).toHaveCount(2);
  await window.getByRole("button", { name: "renomear" }).click();
  const rename = window.getByRole("textbox", { name: "Novo nome da playlist" });
  await rename.fill("Treino pesado");
  await rename.press("Enter");
  await expect.poll(() => saved(page, "jarvis.music.playlists")).toMatchObject([
    { name: "Treino pesado", tracks: [{ videoId: "O_WLw_0DFQQ" }, { videoId: "aqz-KE-bpKQ" }] },
  ]);

  await page.reload();
  await waitForFrames(page);
  await standInMusic(page, 12);
  const reopened = player(page);
  await expect(reopened.getByRole("option", { name: "Treino pesado" })).toHaveAttribute("aria-selected", "true");
  await reopened.getByRole("option", { name: /youtu.be\/aqz-KE-bpKQ/ }).dblclick();
  await expect(nowPlaying(page)).toHaveText("Tocando agora: youtu.be/aqz-KE-bpKQ — YouTube");

  // Deleting asks first; the music from it stops with it.
  await reopened.getByRole("button", { name: "apagar" }).click();
  await reopened.getByRole("button", { name: "[n] não" }).click();
  await expect(reopened.getByRole("option", { name: "Treino pesado" })).toBeVisible();
  await reopened.getByRole("button", { name: "apagar" }).click();
  await reopened.getByRole("button", { name: "[s] sim" }).click();
  await expect(reopened.getByRole("option", { name: "Treino pesado" })).toHaveCount(0);
  await expect(nowPlaying(page)).toHaveCount(0);
  await expect.poll(() => saved(page, "jarvis.music.playlists")).toEqual([]);
});

test("the Fita and Mini player widgets follow the music, which goes on with the player closed", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("jarvis.settings", JSON.stringify({ taskbar: true })));
  await page.reload();
  await waitForFrames(page);
  await standInMusic(page, 30);
  const bar = page.getByRole("navigation", { name: "Barra superior" });

  const window = await openPlayer(page);
  await page.keyboard.press("Enter");
  await expect(nowPlaying(page)).toHaveText("Tocando agora: Out of Touch — Hall and Oates");
  await window.getByRole("button", { name: "Fechar jv_T4p3" }).click();
  await expect(window).toHaveCount(0);
  await expect(bar.getByTestId("taskbar-music")).toHaveText("Out of Touch"); // the artist is in the tooltip

  for (const name of ["Fita", "Mini player"]) {
    await page.getByRole("button", { name: "Widgets", exact: true }).click();
    await page.getByRole("dialog", { name: "Menu de widgets" }).getByRole("button", { name }).click();
    await expect(page.getByRole("dialog", { name })).toBeVisible();
  }
  const tape = page.getByTestId("tape-widget");
  await expect(tape).toContainText("FLASH FM");
  expect(await cassetteMoves(page, tape)).toBe(true);
  const mini = page.getByTestId("mini-player");
  await expect(mini).toContainText("Out of Touch");
  await expect(mini).toContainText("Hall and Oates · Flash FM");
  await page.getByRole("dialog", { name: "Mini player" }).screenshot({ path: `${SCREENS}/music-mini-player.png` });
  await page.getByRole("dialog", { name: "Fita" }).screenshot({ path: `${SCREENS}/music-tape-widget.png` });

  // The mini player skips; the top bar pauses (and the cassette stops).
  await mini.getByRole("button", { name: "Próxima música" }).click();
  await expect(mini).toContainText("Dance Hall Days");
  await expect(bar.getByTestId("taskbar-music")).toHaveText("Dance Hall Days");
  await bar.getByRole("button", { name: "Música: pausar" }).click();
  await expect(mini.getByRole("button", { name: "Tocar" })).toBeVisible();
  expect(await cassetteMoves(page, tape)).toBe(false);
  // The mini player opened over it in cascade: the Fita comes to the front first.
  const fita = page.getByRole("dialog", { name: "Fita" });
  await fita.locator("header").click();
  await fita.getByRole("button", { name: "Tocar a música" }).click();
  await expect(bar.getByRole("button", { name: "Música: pausar" })).toBeVisible();
});

test("voice plays playlists, skips, pauses and opens or closes the player and its widgets", async ({ page }) => {
  await standInMusic(page, 30);
  const notice = (text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

  // The engine's `voice:window` for the player and both widgets.
  for (const [kind, title] of [["music", "jv_T4p3"], ["tape", "Fita"], ["miniplayer", "Mini player"]]) {
    await voiceWindow(page, kind, true);
    await expect(page.getByRole("dialog", { name: title })).toBeVisible({ timeout: 15_000 });
    await voiceWindow(page, kind, false);
    await expect(page.getByRole("dialog", { name: title })).toHaveCount(0);
  }
  await voiceWindow(page, "miniplayer", true);
  const mini = page.getByTestId("mini-player");

  // "toca a Fever" (as Whisper hears it), with no player window.
  await voiceMusic(page, "play", "fever cento e cinco");
  await expect(notice("Tocando Fever 105")).toBeVisible();
  await expect(mini).toContainText("And the Beat Goes On");
  await expect(page.getByRole("dialog", { name: "jv_T4p3" })).toHaveCount(0);

  await voiceMusic(page, "next");
  await expect(mini).toContainText("Act Like You Know");
  await voiceMusic(page, "previous");
  await expect(mini).toContainText("And the Beat Goes On");
  await voiceMusic(page, "pause");
  await expect(notice("Música pausada")).toBeVisible();
  await expect(mini.getByRole("button", { name: "Tocar" })).toBeVisible();
  await voiceMusic(page, "resume");
  await expect(mini.getByRole("button", { name: "Pausar" })).toBeVisible();

  // "muda a playlist" goes to the next station; a name nobody has is said so.
  await voiceMusic(page, "nextPlaylist");
  await expect(notice("Tocando V-Rock")).toBeVisible();
  await expect(mini).toContainText("I Wanna Rock");
  await voiceMusic(page, "previousPlaylist");
  await expect(notice("Tocando Fever 105")).toBeVisible();
  await voiceMusic(page, "play", "samba de raiz");
  await expect(notice("Não achei a playlist “samba de raiz”")).toBeVisible();
  await expect(mini).toContainText("And the Beat Goes On");

  // The user's own playlists answer to their names too.
  await page.evaluate(() =>
    localStorage.setItem("jarvis.music.playlists", JSON.stringify([{ id: "pl-test", name: "Treino pesado", tracks: [{ videoId: "O_WLw_0DFQQ", artist: "Blondie", title: "Atomic" }] }])),
  );
  await page.reload();
  await waitForFrames(page);
  await standInMusic(page, 30);
  await voiceMusic(page, "play", "treino");
  await expect(notice("Tocando Treino pesado")).toBeVisible();
  await expect(page.getByTestId("mini-player")).toContainText("Atomic");
});

test("the search plays a station and opens the player", async ({ page }) => {
  await standInMusic(page, 30);
  await page.keyboard.press("/");
  await page.keyboard.type("tocar emotion");
  const search = page.getByRole("dialog", { name: "Busca" });
  await expect(search.locator('[role="option"][aria-selected="true"]')).toContainText("Tocar Emotion 98.3");
  await page.keyboard.press("Enter");
  await expect(player(page)).toBeVisible({ timeout: 15_000 });
  await expect(nowPlaying(page)).toHaveText("Tocando agora: Waiting for a Girl Like You — Foreigner");

  // With something playing, the search also pauses it and skips.
  await page.keyboard.press("/");
  await page.keyboard.type("pausar a musica");
  await page.keyboard.press("Enter");
  await expect(nowPlaying(page)).toHaveText("Pausado: Waiting for a Girl Like You — Foreigner");
  await page.keyboard.press("/");
  await page.keyboard.type("proxima musica");
  await page.keyboard.press("Enter");
  await expect(nowPlaying(page)).toHaveText("Tocando agora: Wow — Kate Bush");
});
