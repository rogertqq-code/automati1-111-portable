import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  chooseSubmitMethod,
  executeSubmit,
  clickFieldRandomly,
  maybeEarlyFieldClick,
  maybeClickWrongFieldFirst,
  simulateAutofill,
  maybeDoubleClickField,
  maybeTripleClickField,
  maybeCtrlAField,
  maybeOvershootToButton,
  shouldTabToPassword,
  tabToNextField,
  maybeClickEmptyArea,
  maybeScrollToForm,
  maybeClickRememberMe,
  maybeClickLabel,
  maybeDismissAutocomplete,
  maybePostSubmitScroll,
  maybeHoverBeforeClick,
  randomMicroInteraction,
  preFillActions,
  preSubmitActions,
  emailToPasswordTransition,
  maybeTabSwitchSimulation,
  maybeHoverRandomLink,
  maybeAccidentalTextSelect,
  maybeExploreAndReturn,
  mouseIdleDrift,
  maybeKeyboardShortcut,
  maybeSeedTouchEvents,
  maybeFireMouseoverChain,
  fireRealisticFieldEvents,
  performWarmupRandomClicks,
  performZeroCostBehavioralSeeding
} from "../../src/stealth/random-login-actions.js";

vi.mock("../../src/stealth/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  })
}));

vi.mock("../../src/stealth/gaussian-rng.js", () => ({
  gaussianClamped: vi.fn().mockReturnValue(10),
  gaussianInt: vi.fn().mockReturnValue(5),
  gaussianRandom: vi.fn().mockReturnValue(0.5)
}));

vi.mock("../../src/intelligence/mouse-humanizer.js", () => ({
  humanMouseMove: vi.fn().mockResolvedValue(undefined),
  humanScroll: vi.fn().mockResolvedValue(undefined),
  injectMicroTremor: vi.fn().mockResolvedValue(undefined),
  humanClickAt: vi.fn().mockResolvedValue(undefined),
  humanClickSelector: vi.fn().mockResolvedValue(undefined)
}));

describe("random-login-actions", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockLocator: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockElementHandle: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Always return Math.random() < 0.5 unless mocked
    vi.spyOn(Math, "random").mockReturnValue(0.01); // Make it always trigger "maybe" functions

    mockLocator = {
      boundingBox: vi.fn().mockResolvedValue({ x: 10, y: 10, width: 100, height: 20 }),
      inputValue: vi.fn().mockResolvedValue("test@example.com"),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      getAttribute: vi.fn().mockResolvedValue("test-id"),
      nth: vi.fn().mockReturnThis()
    };

    mockElementHandle = {
      boundingBox: vi.fn().mockResolvedValue({ x: 10, y: 10, width: 100, height: 20 })
    };

    mockPage = {
      locator: vi.fn().mockReturnValue(mockLocator),
      $: vi.fn().mockResolvedValue(mockElementHandle),
      $$: vi.fn().mockResolvedValue([mockElementHandle]),
      focus: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(true),
      viewportSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
      isClosed: vi.fn().mockReturnValue(false),
      mouse: {
        move: vi.fn().mockResolvedValue(undefined),
        down: vi.fn().mockResolvedValue(undefined),
        up: vi.fn().mockResolvedValue(undefined),
        dblclick: vi.fn().mockResolvedValue(undefined)
      },
      keyboard: {
        press: vi.fn().mockResolvedValue(undefined),
        down: vi.fn().mockResolvedValue(undefined),
        up: vi.fn().mockResolvedValue(undefined)
      }
    };
  });

  it("chooseSubmitMethod", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    expect(chooseSubmitMethod()).toBe("click");
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(chooseSubmitMethod()).toBe("click_offset");
  });

  it("executeSubmit click", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await executeSubmit(mockPage, "#submit", "#password", "click");
    expect(mockPage.locator).toHaveBeenCalledWith("#submit");
  });

  it("executeSubmit js_submit", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await executeSubmit(mockPage, "#submit", "#password", "js_submit");
    expect(mockPage.evaluate).toHaveBeenCalled();
  });

  it("executeSubmit tab_enter", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await executeSubmit(mockPage, "#submit", "#password", "tab_enter");
    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Tab");
    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Enter");
  });

  it("clickFieldRandomly", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await clickFieldRandomly(mockPage, "#test");
    expect(mockPage.locator).toHaveBeenCalledWith("#test");
  });

  it("maybeEarlyFieldClick", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const res = await maybeEarlyFieldClick(mockPage, "#test");
    expect(res).toBe(true);
  });

  it("maybeClickWrongFieldFirst", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const res = await maybeClickWrongFieldFirst(mockPage, "#email", "#pass");
    expect(res).toBe(true);
  });

  it("simulateAutofill", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const res = await simulateAutofill(mockPage, "#email", "#pass", "test@example.com", "password");
    expect(res).toBe(false); // Returns false because password inputValue is mocked to test@example.com
  });

  it("maybeDoubleClickField", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const res = await maybeDoubleClickField(mockPage, "#test");
    expect(res).toBe(true);
  });

  it("maybeTripleClickField", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const res = await maybeTripleClickField(mockPage, "#test");
    expect(res).toBe(true);
  });

  it("maybeCtrlAField", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const res = await maybeCtrlAField(mockPage, "#test");
    expect(res).toBe(true);
  });

  it("maybeOvershootToButton", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const res = await maybeOvershootToButton(mockPage, "#test");
    expect(res).toBe(true);
  });

  it("shouldTabToPassword", () => {
    expect(shouldTabToPassword()).toBe(true);
  });

  it("tabToNextField", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await tabToNextField(mockPage);
    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Tab");
  });

  it("maybeClickEmptyArea", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await maybeClickEmptyArea(mockPage);
    expect(mockPage.viewportSize).toHaveBeenCalled();
  });

  it("maybeScrollToForm", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await maybeScrollToForm(mockPage, "#form");
    expect(mockLocator.scrollIntoViewIfNeeded).toHaveBeenCalled();
  });

  it("maybeClickRememberMe", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await maybeClickRememberMe(mockPage);
    // Since it is deprecated and handled elsewhere, it shouldn't query the page
    expect(mockPage.$).not.toHaveBeenCalled();
  });

  it("maybeClickLabel", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const res = await maybeClickLabel(mockPage, "#input");
    expect(res).toBe(true);
  });

  it("maybeDismissAutocomplete", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await maybeDismissAutocomplete(mockPage);
    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Escape");
  });

  it("maybePostSubmitScroll", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await maybePostSubmitScroll(mockPage);
  });

  it("maybeHoverBeforeClick", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await maybeHoverBeforeClick(mockPage, "#input");
  });

  it("randomMicroInteraction", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9); // To trigger numActions = 2
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await randomMicroInteraction(mockPage);
  });

  it("preFillActions", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const res = await preFillActions(mockPage, "#email", "#pass");
    expect(res.usedAutofill).toBe(false);
  });

  it("preSubmitActions", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const res = await preSubmitActions(mockPage, "#email", "#submit");
    expect(res.submitMethod).toBeDefined();
  });

  it("emailToPasswordTransition", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const res = await emailToPasswordTransition(mockPage, "#pass");
    expect(res.usedTab).toBe(true); // Because random() < 0.25
  });

  it("maybeTabSwitchSimulation", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await maybeTabSwitchSimulation(mockPage);
    expect(mockPage.evaluate).toHaveBeenCalled();
  });

  it("maybeHoverRandomLink", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await maybeHoverRandomLink(mockPage);
    expect(mockPage.evaluate).toHaveBeenCalled();
  });

  it("maybeAccidentalTextSelect", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await maybeAccidentalTextSelect(mockPage);
    expect(mockPage.mouse.down).toHaveBeenCalled();
  });

  it("maybeExploreAndReturn", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await maybeExploreAndReturn(mockPage, "#form");
    expect(mockLocator.scrollIntoViewIfNeeded).toHaveBeenCalled();
  });



  it("mouseIdleDrift", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await mouseIdleDrift(mockPage);
    expect(mockPage.mouse.move).toHaveBeenCalled();
  });

  it("maybeKeyboardShortcut", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await maybeKeyboardShortcut(mockPage);
    expect(mockPage.keyboard.press).toHaveBeenCalled();
  });

  it("maybeSeedTouchEvents", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await maybeSeedTouchEvents(mockPage);
    expect(mockPage.evaluate).toHaveBeenCalled();
  });

  it("maybeFireMouseoverChain", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await maybeFireMouseoverChain(mockPage, "#test");
    expect(mockPage.evaluate).toHaveBeenCalled();
  });

  it("fireRealisticFieldEvents", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await fireRealisticFieldEvents(mockPage, "#test");
    expect(mockPage.evaluate).toHaveBeenCalled();
  });

  it("performWarmupRandomClicks", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await performWarmupRandomClicks(mockPage, "test@test.com");
    expect(mockPage.evaluate).toHaveBeenCalled();
  });

  it("performZeroCostBehavioralSeeding", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await performZeroCostBehavioralSeeding(mockPage);
    expect(mockPage.evaluate).toHaveBeenCalled();
  });


});
