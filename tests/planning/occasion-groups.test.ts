import { describe, expect, it } from "vitest";
import {
  formalityForKind,
  groupOccasions,
  occasionKind,
  type GroupableOccasion,
} from "@/lib/planning/occasion-groups";

/**
 * How many outfits a day needs is computed, not asked. Leaving the decision to the
 * model was unstable: the same day — a 9:45am board meeting, a 3pm client call and
 * an 8:15pm dinner — came back as two segments on one run and one on the next.
 */

let sequence = 0;

function occ(
  title: string,
  occasion: string,
  formality: number | null,
  extra: Partial<GroupableOccasion> = {}
): GroupableOccasion {
  sequence += 1;
  return { id: `o-${sequence}`, title, occasion, formality, time: "09:00", ...extra };
}

describe("occasionKind", () => {
  it("reads a one-word occasion label literally", () => {
    expect(occasionKind({ occasion: "flight" })).toBe("transit");
    expect(occasionKind({ occasion: "gym" })).toBe("athletic");
    expect(occasionKind({ occasion: "board_meeting" })).toBe("general");
  });

  it("only matches a title on phrasings that cannot be anything else", () => {
    // Titles are prose, so the patterns there are far narrower than for `occasion`.
    expect(occasionKind({ occasion: "meeting", title: "Depart for JFK" })).toBe("transit");
    expect(occasionKind({ occasion: "meeting", title: "Train to Boston" })).toBe("transit");
    expect(occasionKind({ occasion: "meeting", title: "Golf with the Hendersons" })).toBe("athletic");
    expect(occasionKind({ occasion: "meeting", title: "Morning run" })).toBe("athletic");

    // …because these are all meetings.
    expect(occasionKind({ occasion: "meeting", title: "Travel budget review" })).toBe("general");
    expect(occasionKind({ occasion: "meeting", title: "Train the new hire" })).toBe("general");
    expect(occasionKind({ occasion: "meeting", title: "Run through the deck with Priya" })).toBe("general");
  });

  it("never calls an all-day event transit, but keeps all-day sport", () => {
    // "Business Trip (London)" spans every hour including the meetings; dressing
    // the whole workday for a plane is worse than missing the flight.
    expect(occasionKind({ occasion: "travel", title: "Business Trip (London)", allDay: true })).toBe("general");
    // An all-day "Golf Tournament" really is a day of sport.
    expect(occasionKind({ occasion: "golf", title: "Golf Tournament", allDay: true })).toBe("athletic");
  });

  it("prefers athletic when an event is somehow both", () => {
    // A run to the train still has to be sweated in and changed out of.
    expect(occasionKind({ occasion: "run", title: "Morning run to the train station" })).toBe("athletic");
  });
});

describe("formalityForKind", () => {
  it("caps a flight and a match, however formal the company", () => {
    // A flight rated 4 because it belongs to a business trip, and golf rated 4
    // because it is at a client's private club.
    expect(formalityForKind(4, "transit")).toBe(2);
    expect(formalityForKind(4, "athletic")).toBe(2);
    expect(formalityForKind(5, "general")).toBe(5);
    expect(formalityForKind(null, "transit")).toBeNull();
  });
});

describe("groupOccasions", () => {
  it("keeps occasions of the same formality in one outfit", () => {
    const groups = groupOccasions([
      occ("Client call", "client_call", 3),
      occ("Coffee with Dana", "coffee", 3),
      occ("Dinner", "dinner", 3),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "general", formality: 3 });
    expect(groups[0].occasions).toHaveLength(3);
  });

  it("splits on a full step of formality — the break is >=1, not >1", () => {
    // The real test day: a board meeting at 4, then a client call and a dinner at
    // 3, is two outfits rather than one.
    const groups = groupOccasions([
      occ("Board meeting", "board_meeting", 4),
      occ("Client call", "client_call", 3),
      occ("Dinner", "dinner", 3),
    ]);

    expect(groups.map((group) => group.formality)).toEqual([4, 3]);
    expect(groups[1].occasions).toHaveLength(2);
  });

  it("splits when the formality genuinely changes", () => {
    const groups = groupOccasions([occ("Board meeting", "board_meeting", 5), occ("Errands", "casual", 1)]);
    expect(groups.map((group) => group.formality)).toEqual([5, 1]);
  });

  it("splits on a change of kind whatever the formality says", () => {
    // The reported failure: a day of meetings and an overnight flight came back as
    // one outfit in white pumps, because the classifier had rated every event of
    // the business trip at the trip's own formality.
    const groups = groupOccasions([
      occ("Team meeting", "meeting", 4),
      occ("Depart for JFK", "travel", 4),
      occ("Flight to London", "flight", 4),
    ]);

    expect(groups.map((group) => group.kind)).toEqual(["general", "transit"]);
    expect(groups[1].formality).toBe(2); // capped: you are on a plane, not in a boardroom
    expect(groups[1].occasions).toHaveLength(2); // you don't change between the taxi and the gate
  });

  it("gives two athletic sessions their own segments", () => {
    // Unlike transit: you do change between a round of golf and a tennis match.
    const groups = groupOccasions([occ("Golf", "golf", 2), occ("Tennis", "tennis", 2)]);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.kind === "athletic")).toBe(true);
  });

  it("does not let missing formality manufacture an outfit change", () => {
    const groups = groupOccasions([
      occ("Board meeting", "board_meeting", 4),
      occ("Coffee", "coffee", null),
      occ("Client call", "client_call", 4),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].occasions).toHaveLength(3);
  });

  it("returns nothing for an empty day", () => {
    expect(groupOccasions([])).toEqual([]);
  });
});
