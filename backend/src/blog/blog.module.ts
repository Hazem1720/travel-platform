import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommentsModule } from '../comments/comments.module';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AuthorsController } from './authors.controller';
import { AuthorsService } from './authors.service';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { Post, PostSchema } from './schemas/post.schema';
import { TagsController } from './tags.controller';

// BLG-01 to BLG-04, BLG-08 to BLG-10 and BLG-12. ItinerariesModule provides
// the Itinerary model for the author page's public itineraries; CommentsModule
// the comments on the post page (BLG-05) and their removal with a post.
@Module({
  imports: [
    ItinerariesModule,
    CommentsModule,
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [BlogController, TagsController, AuthorsController],
  providers: [BlogService, AuthorsService],
  exports: [BlogService, MongooseModule],
})
export class BlogModule {}
