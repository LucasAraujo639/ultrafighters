package Code.Data
{
   public class MaterialsData
   {
      
      private var _metal:MaterialData = new MaterialData("metal",10,0.4,0.1,"metal",["METAL"],"BULLET_HITMETAL","BULLET_HITMETAL","");
      
      private var _wood:MaterialData = new MaterialData("wood",3,0.6,0.3,"wood",["ANYTHING"],"BULLET_HITDEFAULT","BULLET_HITWOOD","");
      
      private var _paper:MaterialData = new MaterialData("paper",5,0.6,0.1,"PAPER_HIT",["ANYTHING"],"PAPER_HIT","BULLET_HITDEFAULT","");
      
      private var _spark:MaterialData = new MaterialData("spark",1,0.1,1,"",[""],"","","");
      
      private var _beachball:MaterialData = new MaterialData("beachball",0.6,0.4,0.7,"",[""],"BULLET_HITDEFAULT","BULLET_HITDEFAULT","");
      
      private var _ragdoll:MaterialData = new MaterialData("ragdoll",10,0.4,0.1,"PARTICLE_BLOOD",["ANYTHING"],"PARTICLE_BLOOD","BULLET_HITFLESH","");
      
      private var _ground:MaterialData = new MaterialData("ground",1,0.5,0.2,"",[""],"BULLET_HITDEFAULT","BULLET_HITDEFAULT","");
      
      private var _shell:MaterialData = new MaterialData("shell",10,0.4,0.1,"",[""],"","","SHELLBOUNCE");
      
      private var _electric_lamp:MaterialData = new MaterialData("electric_lamp",3,0.4,0.2,"",[""],"ELECTRIC_SPARK","ELECTRIC_SPARK","");
      
      private var _glass:MaterialData = new MaterialData("glass",3,0.4,0.2,"",[""],"","","");
      
      public function MaterialsData()
      {
         super();
      }
      
      public function get Beachball() : MaterialData
      {
         return _beachball.Copy();
      }
      
      public function get Ragdoll() : MaterialData
      {
         return _ragdoll.Copy();
      }
      
      public function get Spark() : MaterialData
      {
         return _spark.Copy();
      }
      
      public function get Wood() : MaterialData
      {
         return _wood.Copy();
      }
      
      public function get Glass() : MaterialData
      {
         return _glass.Copy();
      }
      
      public function get Shell() : MaterialData
      {
         return _shell.Copy();
      }
      
      public function get Metal() : MaterialData
      {
         return _metal.Copy();
      }
      
      public function get Paper() : MaterialData
      {
         return _paper.Copy();
      }
      
      public function get Ground() : MaterialData
      {
         return _ground.Copy();
      }
      
      public function get ElectricLamp() : MaterialData
      {
         return _electric_lamp.Copy();
      }
   }
}

