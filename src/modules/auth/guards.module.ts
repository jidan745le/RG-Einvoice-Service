import { Module } from '@nestjs/common';
import { AuthModule } from './auth.module';
import { AuthGuard } from './auth.guard';

@Module({
    imports: [AuthModule],
    providers: [AuthGuard],
    exports: [AuthGuard],
})
export class GuardsModule { } 