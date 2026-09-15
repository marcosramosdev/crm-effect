import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTERACTIVE_LIMITS,
  sendInteractiveButtons,
  sendInteractiveList,
} from "./uazapi";

// All assertions in this file run BEFORE the network call. Stub fetch to
// a never-resolving mock so a test that accidentally falls through to
// the request body would hang (and fail) rather than silently hitting
// a real gateway. See meta-api.test.ts for the same pattern.
const neverFetch = () =>
  new Promise<Response>(() => {
    /* intentionally never resolves */
  });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE_ARGS = {
  token: "test-token",
  to: "1234567890",
  bodyText: "Body text",
} as const;

describe("sendInteractiveButtons — validation", () => {
  beforeEach(() => {
    vi.stubEnv("UAZAPI_BASE_URL", "https://gateway.example.com");
    vi.stubGlobal("fetch", vi.fn(neverFetch));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects an empty buttons array", async () => {
    await expect(
      sendInteractiveButtons({ ...BASE_ARGS, buttons: [] }),
    ).rejects.toThrow(/1-3 buttons/);
  });

  it(`rejects more than ${INTERACTIVE_LIMITS.maxButtons} buttons`, async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        buttons: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
          { id: "c", title: "C" },
          { id: "d", title: "D" },
        ],
      }),
    ).rejects.toThrow(/1-3 buttons/);
  });

  it("rejects a button title over the limit", async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        buttons: [
          {
            id: "a",
            title: "x".repeat(INTERACTIVE_LIMITS.buttonTitleMaxLength + 1),
          },
        ],
      }),
    ).rejects.toThrow(/exceeds 20 chars/);
  });

  it("rejects a header over the limit", async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        headerText: "x".repeat(INTERACTIVE_LIMITS.headerTextMaxLength + 1),
        buttons: [{ id: "a", title: "A" }],
      }),
    ).rejects.toThrow(/headerText exceeds/);
  });

  it("rejects a duplicate button id", async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        buttons: [
          { id: "a", title: "A" },
          { id: "a", title: "A2" },
        ],
      }),
    ).rejects.toThrow(/duplicate button id/);
  });

  it('rejects a "|" in a button title', async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        buttons: [{ id: "a", title: "Yes|No" }],
      }),
    ).rejects.toThrow(/may not contain "\|"/);
  });

  it('rejects a "|" in a button id', async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        buttons: [{ id: "a|b", title: "A" }],
      }),
    ).rejects.toThrow(/may not contain "\|"/);
  });
});

describe("sendInteractiveButtons — request shape", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends a button menu with pipe-encoded choices", async () => {
    vi.stubEnv("UAZAPI_BASE_URL", "https://gateway.example.com");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { messageid: "wamid-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendInteractiveButtons({
      ...BASE_ARGS,
      footerText: "Footer",
      buttons: [
        { id: "yes", title: "Yes" },
        { id: "no", title: "No" },
      ],
      replyToMessageId: "orig-id",
    });

    expect(result).toEqual({ messageId: "wamid-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gateway.example.com/send/menu");
    expect(JSON.parse(init.body)).toEqual({
      number: "1234567890",
      type: "button",
      text: "Body text",
      choices: ["Yes|yes", "No|no"],
      footerText: "Footer",
      replyid: "orig-id",
    });
  });

  it("folds headerText into the sent text (no header slot on /send/menu)", async () => {
    vi.stubEnv("UAZAPI_BASE_URL", "https://gateway.example.com");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { messageid: "wamid-2" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendInteractiveButtons({
      ...BASE_ARGS,
      headerText: "Header",
      buttons: [{ id: "a", title: "A" }],
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).text).toBe("Header\n\nBody text");
  });
});

const validSections: { rows: { id: string; title: string }[] }[] = [
  { rows: [{ id: "r1", title: "Row 1" }] },
];

describe("sendInteractiveList — validation", () => {
  beforeEach(() => {
    vi.stubEnv("UAZAPI_BASE_URL", "https://gateway.example.com");
    vi.stubGlobal("fetch", vi.fn(neverFetch));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects a missing buttonLabel", async () => {
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: "",
        sections: [...validSections],
      }),
    ).rejects.toThrow(/requires a buttonLabel/);
  });

  it(`rejects more than ${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across sections`, async () => {
    const rows = Array.from(
      { length: INTERACTIVE_LIMITS.maxListRowsTotal + 1 },
      (_, i) => ({
        id: `r${i}`,
        title: `Row ${i}`,
      }),
    );
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: "Choose",
        sections: [{ rows }],
      }),
    ).rejects.toThrow(/1-10 rows total/);
  });

  it("rejects a row title over the limit", async () => {
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: "Choose",
        sections: [
          {
            rows: [
              {
                id: "r1",
                title: "x".repeat(INTERACTIVE_LIMITS.listRowTitleMaxLength + 1),
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/exceeds 24 chars/);
  });

  it('rejects a "|" in a row description', async () => {
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: "Choose",
        sections: [{ rows: [{ id: "r1", title: "Row", description: "a|b" }] }],
      }),
    ).rejects.toThrow(/may not contain "\|"/);
  });

  it('rejects a "|" in a section title', async () => {
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: "Choose",
        sections: [{ title: "Sec|tion", rows: [{ id: "r1", title: "Row" }] }],
      }),
    ).rejects.toThrow(/may not contain "\|"/);
  });
});

describe("sendInteractiveList — request shape", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('encodes section headers as "[Title]" and rows as pipe-delimited choices', async () => {
    vi.stubEnv("UAZAPI_BASE_URL", "https://gateway.example.com");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { messageid: "wamid-3" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendInteractiveList({
      ...BASE_ARGS,
      buttonLabel: "View options",
      sections: [
        {
          title: "Electronics",
          rows: [
            { id: "phones", title: "Phones", description: "Latest models" },
            { id: "laptops", title: "Laptops" },
          ],
        },
      ],
    });

    expect(result).toEqual({ messageId: "wamid-3" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gateway.example.com/send/menu");
    expect(JSON.parse(init.body)).toEqual({
      number: "1234567890",
      type: "list",
      text: "Body text",
      listButton: "View options",
      choices: [
        "[Electronics]",
        "Phones|phones|Latest models",
        "Laptops|laptops",
      ],
    });
  });
});
