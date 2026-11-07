import { DefaultNamingStrategy, type NamingStrategyInterface } from 'typeorm';

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/** Entity properties are camelCase; the tables keep their snake_case columns. */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override columnName(propertyName: string, customName: string | undefined, embeddedPrefixes: string[]): string {
    return customName ?? snake([...embeddedPrefixes, propertyName].join('_'));
  }
}
