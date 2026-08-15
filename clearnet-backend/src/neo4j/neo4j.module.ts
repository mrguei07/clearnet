import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver } from 'neo4j-driver';

export const NEO4J_DRIVER = 'NEO4J_DRIVER';

@Injectable()
export class Neo4jConnection implements OnApplicationShutdown {
  constructor(@Inject(NEO4J_DRIVER) private readonly driver: Driver) {}

  async onApplicationShutdown() {
    await this.driver.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: NEO4J_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Driver => {
        const uri = config.get<string>('NEO4J_URI', 'bolt://localhost:7687');
        const user = config.get<string>('NEO4J_USER', 'neo4j');
        const password = config.get<string>('NEO4J_PASSWORD', 'clearnet123');
        return neo4j.driver(uri, neo4j.auth.basic(user, password));
      },
    },
    Neo4jConnection,
  ],
  exports: [NEO4J_DRIVER],
})
export class Neo4jModule {
  static forRoot() {
    return Neo4jModule;
  }
}
