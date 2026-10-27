package Code.Box2D.Collision
{
   import Code.Box2D.Common.Math.b2Mat22;
   import Code.Box2D.Common.Math.b2Vec2;
   
   public class b2OBB
   {
      
      public var R:b2Mat22 = new b2Mat22();
      
      public var center:b2Vec2 = new b2Vec2();
      
      public var extents:b2Vec2 = new b2Vec2();
      
      public function b2OBB()
      {
         super();
      }
   }
}

