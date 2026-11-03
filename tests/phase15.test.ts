import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CHARS, STT_LOCALES, VOICES, acceptableAudio, speakableText, speechLocale, ssml, voiceFor } from "@/lib/core/speech";
import { INTERVIEW_LANGUAGES } from "@/lib/core/languages";

describe("natural voice: locales and voices", () => {
  it("uses the organisation's English accent and each language's own locale", () => {
    expect(speechLocale("en-IN", "en-GB")).toBe("en-GB");
    expect(speechLocale("hi-IN", "en-US")).toBe("hi-IN");
  });
  it("has a female and a male voice for every interview language", () => {
    for (const l of INTERVIEW_LANGUAGES) {
      const loc = speechLocale(l.speech, "en-IN");
      expect(voiceFor(loc, "female")).toMatch(/Neural$/);
      expect(voiceFor(loc, "male")).toMatch(/Neural$/);
      expect(voiceFor(loc, "female")).not.toBe(voiceFor(loc, "male"));
    }
    expect(voiceFor("xx-XX", "female")).toBeNull();
    expect(voiceFor("en-IN", "male", { "en-IN": ["A", "B"] })).toBe("B");
  });
  it("only lists transcription locales that also have voices", () => {
    for (const l of STT_LOCALES) expect(VOICES[l]).toBeTruthy();
  });
});

describe("natural voice: what is read aloud", () => {
  it("drops markdown and replaces code with a pointer to the screen", () => {
    const t = speakableText("## Next\n**Great** answer. Look at `map()` and [the docs](https://x.y).\n```js\nconst a = 1;\n```\n- point one");
    expect(t).not.toMatch(/[#*`[\]]/);
    expect(t).toContain("Great answer.");
    expect(t).toContain("map()");
    expect(t).toContain("the docs");
    expect(t).toContain("see the code on screen");
    expect(t).toContain("point one");
  });
  it("caps very long messages at a sentence boundary", () => {
    const long = "This is a sentence. ".repeat(400);
    const t = speakableText(long);
    expect(t.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS + 30);
    expect(t.endsWith("The rest is on screen.")).toBe(true);
  });
  it("escapes text so a message can't inject SSML", () => {
    const x = ssml(`Use <break time="9s"/> & "quotes"`, "en-IN-NeerjaNeural", "en-IN");
    expect(x).toContain("&lt;break time=&quot;9s&quot;/&gt; &amp; &quot;quotes&quot;");
    expect(x).toContain('<voice name="en-IN-NeerjaNeural">');
    expect(x.match(/<break/g)).toBeNull();
    expect(ssml("Hi", "v", "en-IN", 10)).toContain('<prosody rate="+10%">Hi</prosody>');
  });
});

describe("natural voice: recordings", () => {
  it("accepts the formats browsers record in and nothing else", () => {
    for (const t of ["audio/webm;codecs=opus", "audio/ogg; codecs=opus", "audio/mp4", "audio/wav", "video/webm"]) expect(acceptableAudio(t)).toBe(true);
    for (const t of ["text/plain", "application/json", "image/png", ""]) expect(acceptableAudio(t)).toBe(false);
  });
});
