import { storeIdToCountry } from "../apple/config";
import type { Account } from "../types";

export function preferredAccountEmail(
  accounts: Account[],
  preferredEmail: string,
  country?: string,
): string {
  const countryAccount = country
    ? accounts.find((account) => storeIdToCountry(account.store) === country)
    : undefined;
  if (countryAccount) {
    return countryAccount.email;
  }

  if (
    preferredEmail &&
    accounts.some((account) => account.email === preferredEmail)
  ) {
    return preferredEmail;
  }

  return accounts[0]?.email ?? "";
}
