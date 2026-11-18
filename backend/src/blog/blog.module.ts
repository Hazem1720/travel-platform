
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { BlogController } from './blog.controller';
import { TagsController } from './tags.controller';
import { AuthorsController } from './authors.controller';
import { BlogService } from './blog.service';
import { AuthorsService } from './authors.service';
import { Post, PostSchema } from './schemas/post.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    ItinerariesModule,
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [
    BlogController,
    TagsController,
    AuthorsController,
  ],
  providers: [
    BlogService,
    AuthorsService,
  ],
  exports: [BlogService],
})
export class BlogModule {}
