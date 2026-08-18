import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CONFIG, JwtService, type AppConfig } from '@ssm/nest-common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { UserEntity } from '../users/user.entity.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RefreshTokenEntity } from './refresh-token.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, RefreshTokenEntity])],
  controllers: [AuthController],
  providers: [
    {
      provide: AuthService,
      inject: [getDataSourceToken(), JwtService, CONFIG],
      useFactory: (db: DataSource, jwt: JwtService, cfg: AppConfig) =>
        new AuthService(db, jwt, cfg),
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
