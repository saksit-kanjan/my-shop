import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('doc_counters')
export class DocCounter {
  @PrimaryColumn('text') key!: string;
  @Column('int') last!: number;
}
