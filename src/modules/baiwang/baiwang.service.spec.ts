import { Test, TestingModule } from '@nestjs/testing';
import { BaiwangService } from './baiwang.service';

describe('BaiwangService', () => {
  let service: BaiwangService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BaiwangService],
    }).compile();

    service = module.get<BaiwangService>(BaiwangService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
