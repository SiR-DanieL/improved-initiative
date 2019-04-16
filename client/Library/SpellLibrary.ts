import * as ko from "knockout";

import { StoredListing } from "../../common/Listable";
import { Spell } from "../../common/Spell";
import { concatenatedStringRegex } from "../../common/Toolbox";
import { AccountClient } from "../Account/AccountClient";
import { Store } from "../Utility/Store";
import { Listing, ListingOrigin } from "./Listing";

export class SpellLibrary {
  private spells = ko.observableArray<Listing<Spell>>([]);
  public GetSpells = ko.pureComputed(() => this.spells());
  public SpellsByNameRegex = ko.pureComputed(() =>
    concatenatedStringRegex(this.GetSpells().map(s => s.Get().Name))
  );

  constructor(private accountClient: AccountClient) {}

  public AddListings = (listings: StoredListing[], source: ListingOrigin) => {
    ko.utils.arrayPushAll<Listing<Spell>>(
      this.spells,
      listings.map(c => {
        return new Listing<Spell>(
          c.Id,
          c.Name,
          c.Path,
          c.SearchHint,
          c.Metadata,
          c.Link,
          source
        );
      })
    );
  };

  public AddOrUpdateSpell = (spell: Spell) => {
    this.spells.remove(listing => listing.Get().Id === spell.Id);
    spell.Id = AccountClient.MakeId(spell.Id);
    const listing = new Listing<Spell>(
      spell.Id,
      spell.Name,
      spell.Path,
      Spell.GetKeywords(spell),
      Spell.GetMetadata(spell),
      Store.Spells,
      "localStorage",
      spell
    );
    this.spells.push(listing);
    Store.Save(Store.Spells, spell.Id, spell);
    this.accountClient.SaveSpell(spell).then(r => {
      if (!r) return;
      if (listing.Origin === "account") return;
      const accountListing = new Listing<Spell>(
        spell.Id,
        spell.Name,
        spell.Path,
        Spell.GetKeywords(spell),
        Spell.GetMetadata(spell),
        `/my/spells/${spell.Id}`,
        "account",
        spell
      );
      this.spells.push(accountListing);
    });
  };

  public DeleteSpellById = (id: string) => {
    this.spells.remove(listing => listing.Get().Id === id);
    Store.Delete(Store.Spells, id);
    this.accountClient.DeleteSpell(id);
  };
}
